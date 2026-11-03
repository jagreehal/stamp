// Impact leads: where a change may reach beyond its diff. Changed exports and the files outside the PR that name
// them, and the test files that sit beside each changed source file. Advisory context only: a lead says where to
// look, it never stands in for reading the diff, and nothing here gates.
import { execFileSync } from "node:child_process";
import { callTimeout } from "./github.ts";
import { isSizeExempt, LOCKFILE_RE } from "./policy.ts";

export type Leads = {
  /** An exported name the diff adds, removes or rewrites, and up to MAX_CALLERS files outside the PR that name it. */
  symbols: { name: string; callers: string[] }[];
  /** Changed source files with the test files that match their name; `tests` is empty when none does. */
  sources: { file: string; tests: string[] }[];
  /** Names only one side of the diff holds, and where the head uses them. */
  names: NameLead[];
};

type At = { file: string; line: number };

/** A name whose count changed, however it is written: an env var, a config key, a private helper, a string constant. */
export type NameLead = { name: string; added: At | null; removed: At | null; count: number; refs: (At & { text: string })[] };

const MAX_SYMBOLS = 8;

const MAX_CALLERS = 5;

const MAX_SOURCES = 10;

// A declaration's name on a diff line: TS/JS exports, Python top-level defs and classes, Go exported funcs.
const DECLARATION = [
  /^[+-]\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^[+-](?:def|class)\s+([A-Za-z_]\w*)/,
  /^[+-]func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/,
];

const MAX_CANDIDATES = 24;

const MAX_NAMES = 12;

const MAX_REFS = 6;

const MAX_EXCERPT = 160;

// Lockfiles and tests churn names by the thousand. Name leads skip them; the reviewer still reads them as diff.
const noisy = (file: string) => isSizeExempt(file) || LOCKFILE_RE.test(file);

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb)$/;

const TEST_FILE = /(^|\/)(__tests__\/|tests?\/)|[._-](test|spec)\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.go$/;

/** The names the diff's hunk lines declare, in order of first appearance, at most MAX_SYMBOLS. */
export function changedSymbols(diff: string): string[] {
  const names = new Set<string>();
  let inHunk = false;

  for (const l of diff.split("\n")) {
    if (l.startsWith("diff --git ")) inHunk = false;
    else if (l.startsWith("@@")) inHunk = true;
    else if (inHunk)
      for (const re of DECLARATION) {
        const name = re.exec(l)?.[1];

        if (name && name.length > 2) names.add(name);
      }
  }

  return [...names].slice(0, MAX_SYMBOLS);
}

type Change = { name: string; declared: boolean; added: At[]; removed: At[] };

const DECLARES = /\b(?:const|let|var|function|class|type|interface|enum|def|func|fn|struct)\s+([A-Za-z_]\w*)/g;

/**
 * Names only one side of the diff holds, removed ones first, then declarations: a renamed or removed name
 * leaves references behind that the diff cannot show. A name with a capital or underscore only: plain words are prose.
 * `addedLines` holds `path:line` of every line the PR added.
 */
export function changedNames(diff: string) {
  const changes = new Map<string, Change>();
  const addedLines = new Set<string>();
  let oldPath = "";
  let newPath = "";
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;

  const record = (text: string, kind: "added" | "removed", at: At) => {
    const declared = new Set([...text.matchAll(DECLARES)].map((m) => m[1]));

    for (const name of new Set(text.match(/[A-Za-z_]\w*/g))) {
      if (name.length < 4 || name.length > 128 || !/[A-Z_]/.test(name)) continue;
      const c = changes.get(name) ?? { name, declared: false, added: [], removed: [] };

      c.declared ||= declared.has(name);
      c[kind].push(at);
      changes.set(name, c);
    }
  };

  for (const l of diff.split("\n")) {
    // A hunk's own counts decide where it ends, so an added line reading `+++ x` stays an added line.
    if (oldLeft > 0 || newLeft > 0) {
      if (l[0] === "+") {
        addedLines.add(`${newPath}:${newLine}`);

        if (!noisy(newPath)) record(l.slice(1), "added", { file: newPath, line: newLine });
        newLine++;
        newLeft--;
      } else if (l[0] === "-") {
        if (!noisy(oldPath)) record(l.slice(1), "removed", { file: oldPath, line: oldLine });
        oldLine++;
        oldLeft--;
      } else if (l[0] !== "\\") {
        oldLine++;
        newLine++;
        oldLeft--;
        newLeft--;
      }

      continue;
    }

    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);

    if (hunk) {
      oldLine = Number(hunk[1]);
      oldLeft = Number(hunk[2] ?? 1);
      newLine = Number(hunk[3]);
      newLeft = Number(hunk[4] ?? 1);
    } else if (l.startsWith("--- ")) oldPath = l.slice(4).replace(/^a\//, "").replace(/\t$/, "");
    else if (l.startsWith("+++ ")) newPath = l.slice(4).replace(/^b\//, "").replace(/\t$/, "");
  }

  const rank = (a: Change, b: Change) => Number(b.removed.length > 0) - Number(a.removed.length > 0) || Number(b.declared) - Number(a.declared) || a.name.localeCompare(b.name);

  // A rename leaves its old name on one side and its new name on the other. Removed names rank first.
  return { candidates: [...changes.values()].filter((c) => !c.added.length || !c.removed.length).sort(rank).slice(0, MAX_CANDIDATES), addedLines };
}

/** `git grep -nz` output over the candidates: each name's lines outside the PR's added ones, a few kept with their text. */
export function nameLeads(candidates: Change[], addedLines: Set<string>, grep: string): NameLead[] {
  const lead = (c: Change): NameLead => ({ name: c.name, added: c.added[0] ?? null, removed: c.removed[0] ?? null, count: 0, refs: [] });
  const leads = new Map(candidates.map((c) => [c.name, lead(c)]));

  for (const record of grep.split("\n")) {
    const [file, n, text] = record.split("\0");
    const line = Number(n);

    if (!file || !Number.isInteger(line) || text === undefined || addedLines.has(`${file}:${line}`)) continue;

    for (const word of new Set(text.match(/[A-Za-z_][A-Za-z0-9_]*/g))) {
      const hit = leads.get(word);

      if (!hit) continue;
      hit.count++;

      if (hit.refs.length < MAX_REFS) hit.refs.push({ file, line, text: text.trim().slice(0, MAX_EXCERPT) });
    }
  }

  return [...leads.values()].filter((l) => l.count > 0).slice(0, MAX_NAMES);
}

/** A file's language, so a TypeScript source never claims a Go test: JS and TS share one, any other extension is its own. */
const family = (f: string) => {
  const ext = /\.([^./]+)$/.exec(f)?.[1] ?? "";

  return /^[cm]?[jt]sx?$/.test(ext) ? "js" : ext;
};

/** Tracked test files whose name matches the source file's stem: `a.ts` → `a.test.ts`, `__tests__/a.ts`, `test_a.py`, `a_test.go`. */
export function relatedTests(file: string, tracked: string[]): string[] {
  const stem = file.split("/").at(-1)!.replace(/\.[^.]+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(`(^|/)(test_)?${stem}([._-](test|spec))?\\.[^/]+$|(^|/)${stem}_test\\.go$`);

  const lang = family(file);

  return tracked.filter((t) => t !== file && TEST_FILE.test(t) && named.test(t) && family(t) === lang);
}

export type LeadDeps = {
  /** Tracked files, `git ls-files`. */
  tracked: () => string[];
  /** Tracked files naming `word` as a whole word, `git grep -lw`. */
  naming: (word: string) => string[];
  /** Every tracked line matching `pattern` as a whole word, `git grep -nz`; "" when git cannot answer. */
  lines: (pattern: string) => string;
};

export function impactLeads(diff: string, changed: string[], deps: LeadDeps): Leads {
  const inPR = new Set(changed);
  const tracked = deps.tracked();
  const exported = changedSymbols(diff);
  const { candidates, addedLines } = changedNames(diff);
  // An exported name is listed with its callers already.
  const others = candidates.filter((c) => !exported.includes(c.name));

  return {
    names: others.length ? nameLeads(others, addedLines, deps.lines(others.map((c) => c.name).join("|"))) : [],
    // A caller is code: a doc or changelog that mentions the name is not one.
    symbols: exported.map((name) => ({ name, callers: deps.naming(name).filter((f) => !inPR.has(f) && SOURCE.test(f)).slice(0, MAX_CALLERS) })),
    sources: changed
      .filter((f) => !TEST_FILE.test(f) && SOURCE.test(f))
      .slice(0, MAX_SOURCES)
      .map((file) => ({ file, tests: relatedTests(file, tracked).slice(0, 3) })),
  };
}

/** Leads over a checkout, through git: no PR code runs. Null when git fails, so the prompt simply goes without. */
export function leadsAt(root: string, diff: string, changed: string[]): Leads | null {
  const git = (...args: string[]) => {
    try {
      return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 16 << 20, timeout: callTimeout(), stdio: ["ignore", "pipe", "ignore"] });
    } catch (e) {
      // git grep exits 1 for "no matches", which is an answer.
      if (e instanceof Error && "status" in e && e.status === 1) return "";
      throw e;
    }
  };

  // -z: paths as they are, NUL-separated. Without it git quotes a path holding a tab, a quote or non-ASCII bytes
  // (`"src/caf\303\251.ts"`), and the quoted name matches neither the PR's files nor a test's.
  const paths = (s: string) => s.split("\0").filter(Boolean);

  // One alternation keeps the grep linear: with an `-e` per name, git rescans each pattern after a match. Names are
  // word characters, so they need no escaping.
  const lines = (pattern: string) => {
    try {
      return git("grep", "--no-color", "--full-name", "-nzIwE", "-e", pattern);
    } catch {
      return "";
    }
  };

  try {
    return impactLeads(diff, changed, { tracked: () => paths(git("ls-files", "-z")), naming: (w) => paths(git("grep", "-lwFz", "--", w)), lines });
  } catch {
    return null;
  }
}

/** The leads for the prompt: one line each, untrusted names passed through `clean` by the caller. */
export function formatLeads(leads: Leads, clean: (s: string) => string): string[] {
  const symbols = leads.symbols.map((s) => `${clean(s.name)}: ${s.callers.length ? `named in ${s.callers.map(clean).join(", ")}` : "named nowhere outside this PR"}`);
  const sources = leads.sources.map((s) => `${clean(s.file)}: ${s.tests.length ? `tests in ${s.tests.map(clean).join(", ")}` : "no test file matches its name"}`);

  const at = (a: At) => `${clean(a.file)}:${a.line}`;

  const names = leads.names.map((n) => {
    const changed = [n.removed && `removed at ${at(n.removed)}`, n.added && `added at ${at(n.added)}`].filter(Boolean).join(", ");

    return `${clean(n.name)}: ${changed}; ${n.count} line(s) in the head use it${n.count > n.refs.length ? `, first ${n.refs.length}` : ""}: ${n.refs.map((r) => `${at(r)} ${JSON.stringify(clean(r.text))}`).join("; ")}`;
  });

  return [...symbols, ...names, ...sources];
}
