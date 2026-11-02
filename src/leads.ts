// Impact leads: where a change may reach beyond its diff. Changed exports and the files outside the PR that name
// them, and the test files that sit beside each changed source file. Advisory context only: a lead says where to
// look, it never stands in for reading the diff, and nothing here gates.
import { execFileSync } from "node:child_process";
import { callTimeout } from "./github.ts";

export type Leads = {
  /** An exported name the diff adds, removes or rewrites, and up to MAX_CALLERS files outside the PR that name it. */
  symbols: { name: string; callers: string[] }[];
  /** Changed source files with the test files that match their name; `tests` is empty when none does. */
  sources: { file: string; tests: string[] }[];
};

const MAX_SYMBOLS = 8;

const MAX_CALLERS = 5;

const MAX_SOURCES = 10;

// A declaration's name on a diff line: TS/JS exports, Python top-level defs and classes, Go exported funcs.
const DECLARATION = [
  /^[+-]\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^[+-](?:def|class)\s+([A-Za-z_]\w*)/,
  /^[+-]func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/,
];

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
};

export function impactLeads(diff: string, changed: string[], deps: LeadDeps): Leads {
  const inPR = new Set(changed);
  const tracked = deps.tracked();

  return {
    // A caller is code: a doc or changelog that mentions the name is not one.
    symbols: changedSymbols(diff).map((name) => ({ name, callers: deps.naming(name).filter((f) => !inPR.has(f) && SOURCE.test(f)).slice(0, MAX_CALLERS) })),
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

  try {
    return impactLeads(diff, changed, { tracked: () => paths(git("ls-files", "-z")), naming: (w) => paths(git("grep", "-lwFz", "--", w)) });
  } catch {
    return null;
  }
}

/** The leads for the prompt: one line each, untrusted names passed through `clean` by the caller. */
export function formatLeads(leads: Leads, clean: (s: string) => string): string[] {
  const symbols = leads.symbols.map((s) => `${clean(s.name)}: ${s.callers.length ? `named in ${s.callers.map(clean).join(", ")}` : "named nowhere outside this PR"}`);
  const sources = leads.sources.map((s) => `${clean(s.file)}: ${s.tests.length ? `tests in ${s.tests.map(clean).join(", ")}` : "no test file matches its name"}`);

  return [...symbols, ...sources];
}
