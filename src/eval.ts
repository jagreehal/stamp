// The review benchmark: frozen changes with known outcomes, reviewed through stamp's own path, scored for the
// verdicts that matter to an approval bot. A case is a plain git repository (`export` writes one), so any other
// reviewer can review the same change and be scored from run records in the same shape.
//
//   bun run eval run evals/cases --label nova --repeat 3        (STAMP_MODEL / STAMP_API_KEY as for a review; --case one)
//   bun run eval score evals/runs
//   bun run eval export evals/cases/off-by-one /tmp/off-by-one  (a repository: base on main, the change on pr)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { setting } from "./config.ts";
import type { PR } from "./github.ts";
import { leadsAt } from "./leads.ts";
import { assured, diffCut, readAll, review, reviewers, type Backend } from "./reviewer.ts";

// A file's content: text, or a line repeated (`{ "repeat": "x = 1", "times": 20000 }`) for a diff past the prompt limit.
const Content = z.union([z.string(), z.object({ repeat: z.string(), times: z.number().int().positive() }).transform((r) => `${Array.from({ length: r.times }, () => r.repeat).join("\n")}\n`)]);

/** A case path stays inside its repository: relative, no `..`, nothing under `.git`, where a hook would run. */
const CasePath = z.string().refine((p) => {
  const parts = p.split(/[\\/]/);

  return p !== "" && !path.isAbsolute(p) && !/^[a-z]:/i.test(p) && !parts.includes("..") && !parts.some((s) => s.toLowerCase() === ".git");
}, "a case path is relative, inside the repository and outside .git");

export const Case = z.object({
  title: z.string(),
  body: z.string().default(""),
  base: z.record(CasePath, Content),
  /** The change: new content per path, null to delete. Paths not named keep their base content. */
  head: z.record(CasePath, Content.nullable()),
  /** `block`: a safe reviewer does not approve. `approve`: nothing in it should hold an approval back. */
  expect: z.enum(["approve", "block"]),
  /** The bugs a person confirmed: credited when one issue names the file and matches a pattern. */
  bugs: z.array(z.object({ id: z.string(), file: z.string(), match: z.array(z.string()).min(1) })).default([]),
  split: z.enum(["dev", "held-out"]).default("dev"),
});

export type Case = z.infer<typeof Case>;

/** One review of one case, by any reviewer. `verdict` is null when the run failed. */
export const Run = z.object({
  case: z.string(),
  label: z.string(),
  verdict: z.enum(["APPROVE", "REFUSE", "ESCALATE"]).nullable(),
  /** The model's own verdict, before stamp's approval checks (assured, readAll): where they differ, stamp held it. */
  model_verdict: z.enum(["APPROVE", "REFUSE", "ESCALATE"]).nullable().optional(),
  issues: z.array(z.string()),
  costUsd: z.number().nullable(),
  durationMs: z.number(),
  error: z.string().optional(),
});

export type Run = z.infer<typeof Run>;

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "core.hooksPath=/dev/null", "-c", "user.name=eval", "-c", "user.email=eval@localhost", "-c", "core.quotepath=true", ...args], { encoding: "utf8", maxBuffer: 256 << 20 }).trim();

/** A materialized case: the PR's diff and its changed files, as stamp reads them from GitHub. */
export type Change = { diff: string; files: PR["files"] };

/** The case as a repository in `dir`: its base committed on `main`, the change on `pr`. */
export function materialize(c: Case, dir: string): Change {
  const put = (files: Record<string, string | null>) => {
    for (const [p, content] of Object.entries(files)) {
      const at = path.resolve(dir, p);

      // The schema checked the spelling; this checks where it lands.
      if (!at.startsWith(path.resolve(dir) + path.sep)) throw new Error(`case path escapes the repository: ${p}`);

      if (content === null) rmSync(at, { force: true });
      else {
        mkdirSync(path.dirname(at), { recursive: true });
        writeFileSync(at, content);
      }
    }

    git(dir, "add", "-A");
  };

  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  put(c.base);
  git(dir, "commit", "-qm", "base");
  git(dir, "checkout", "-qb", "pr");
  put(c.head);
  git(dir, "commit", "-qm", c.title);

  return { diff: `${git(dir, "diff", "-M", "main", "pr")}\n`, files: changedFiles(git(dir, "diff", "-M", "--numstat", "-z", "main", "pr"), git(dir, "diff", "-M", "--name-status", "-z", "main", "pr")) };
}

const STATUS = new Map([["A", "added"], ["D", "removed"], ["R", "renamed"], ["C", "copied"]]);

/**
 * The PR's files as GitHub's API lists them, from `git diff -z` output. A rename or copy spans tokens: numstat
 * writes `add\tdel\t` then the old and new paths as tokens of their own, name-status writes `R100` then both.
 */
export function changedFiles(numstat: string, nameStatus: string): PR["files"] {
  const status = new Map<string, string>();
  const st = nameStatus.split("\0");

  for (let i = 0; i + 1 < st.length; ) {
    const code = st[i]![0]!;

    if (code === "R" || code === "C") {
      status.set(st[i + 2]!, STATUS.get(code)!);
      i += 3;
    } else {
      status.set(st[i + 1]!, STATUS.get(code) ?? "modified");
      i += 2;
    }
  }

  const files: PR["files"] = [];
  const ns = numstat.split("\0");

  for (let i = 0; i < ns.length; i++) {
    // `add\tdel\tpath`: split at the first two tabs only, since a path may hold tabs of its own.
    const [, add = "", del = "", path = ""] = /^([^\t]*)\t([^\t]*)\t?([\s\S]*)$/.exec(ns[i]!) ?? [];

    if (!add) continue;
    // Binary files count "-" for both: no lines to size.
    const counts = { additions: Number(add) || 0, deletions: Number(del) || 0 };

    if (path) {
      files.push({ filename: path, ...counts, status: status.get(path) ?? "modified" });
    } else {
      const [previousFilename = "", filename = ""] = [ns[i + 1], ns[i + 2]];

      files.push({ filename, previousFilename, ...counts, status: status.get(filename) ?? "renamed" });
      i += 2;
    }
  }

  return files;
}


export function loadCases(dir: string): [string, Case][] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d): [string, Case] => [d.name, Case.parse(JSON.parse(readFileSync(path.join(dir, d.name, "case.json"), "utf8")))])
    .sort(([a], [b]) => a.localeCompare(b));
}

/** One review through stamp's own path: the prompt, leads and read tools a PR gets, then the approval checks the CLI applies. */
export async function runCase(name: string, c: Case, backend: Backend, label: string, guidance: string): Promise<Run> {
  const dir = mkdtempSync(path.join(tmpdir(), `stamp-eval-${name}-`));
  const started = Date.now();

  try {
    const { diff, files } = materialize(c, dir);
    const size = files.reduce((n, f) => n + f.additions + f.deletions, 0);

    const pr: PR = {
      repo: "eval/case", number: 1, title: c.title, body: c.body, author: "eval", authorAssociation: "MEMBER", isFork: false, isDraft: false, mergeable: "MERGEABLE",
      baseRef: "main", headRef: "pr", defaultBranch: "main", headSha: git(dir, "rev-parse", "pr"), baseSha: git(dir, "rev-parse", "main"),
      labels: [], files, reviews: [], inline: [], discussion: [], reactions: [], commits: [], diff,
    };

    const input = {
      pr,
      gates: [{ gate: "size", passed: true, message: `${size} lines / ${files.length} files` }],
      gateVerdict: "PASSED" as const,
      tier: "T1-agent",
      titleFlags: [],
      manifests: [],
      scrutiny: [],
      leads: leadsAt(dir, diff, files.flatMap((f) => [f.filename, ...(f.previousFilename ? [f.previousFilename] : [])])),
    };

    const llm = await review(backend, input, guidance, dir);
    const outcome = readAll(assured({ verdict: llm.verdict, llm }), diffCut(diff), [llm]);

    return { case: name, label, verdict: outcome.verdict, model_verdict: llm.verdict, issues: outcome.llm.issues, costUsd: llm.run?.costUsd ?? null, durationMs: Date.now() - started };
  } catch (e) {
    return { case: name, label, verdict: null, issues: [], costUsd: null, durationMs: Date.now() - started, error: String(e instanceof Error ? e.message : e).split("\n")[0] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Bug ids an issue list finds: an issue naming the bug's file (or its basename) that matches one of its patterns. */
export function found(c: Case, issues: string[]): string[] {
  return c.bugs.flatMap((b) =>
    issues.some((i) => (i.includes(b.file) || i.includes(path.basename(b.file))) && b.match.some((m) => new RegExp(m, "i").test(i))) ? [b.id] : [],
  );
}

export type Score = {
  label: string;
  runs: number;
  errors: number;
  /** Approvals of a `block` case: the failure an approval bot must not have. */
  unsafe_approvals: number;
  /** `approve` cases held back: a cost to the team, never a safety failure. */
  false_holds: number;
  bug_recall: number | null;
  /** Issues on `block` cases that find no listed bug, and every issue on an `approve` case. Check them: one may be a bug nobody listed. */
  unmatched_issues: number;
  /** Runs whose model approved and stamp's checks held back: what the checks add over the model alone. */
  held_by_stamp: number;
  cost_usd: number | null;
  median_ms: number;
};

export function score(cases: Map<string, Case>, runs: Run[]): Score[] {
  const labels = [...new Set(runs.map((r) => r.label))].sort();

  return labels.map((label) => {
    const mine = runs.filter((r) => r.label === label && cases.has(r.case));
    const done = mine.filter((r) => r.verdict !== null);
    let bugs = 0;
    let hits = 0;
    let unmatched = 0;

    for (const r of done) {
      const c = cases.get(r.case)!;
      const ids = found(c, r.issues);

      bugs += c.bugs.length;
      hits += ids.length;
      unmatched += c.expect === "approve" ? r.issues.length : r.issues.filter((i) => !found(c, [i]).length).length;
    }

    const ms = mine.map((r) => r.durationMs).sort((a, b) => a - b);
    const costs = mine.map((r) => r.costUsd);

    return {
      label,
      runs: mine.length,
      errors: mine.length - done.length,
      unsafe_approvals: done.filter((r) => r.verdict === "APPROVE" && cases.get(r.case)!.expect === "block").length,
      false_holds: done.filter((r) => r.verdict !== "APPROVE" && cases.get(r.case)!.expect === "approve").length,
      bug_recall: bugs ? hits / bugs : null,
      unmatched_issues: unmatched,
      held_by_stamp: done.filter((r) => r.model_verdict === "APPROVE" && r.verdict !== "APPROVE").length,
      cost_usd: costs.every((c) => c !== null) ? costs.reduce<number>((n, c) => n + c!, 0) : null,
      median_ms: ms[Math.floor(ms.length / 2)] ?? 0,
    };
  });
}

const readRuns = (dir: string): Run[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true }).flatMap((f) => (f.isFile() && f.name.endsWith(".json") ? [Run.parse(JSON.parse(readFileSync(path.join(f.parentPath, f.name), "utf8")))] : []));

if (import.meta.main) {
  const [command, a, b] = process.argv.slice(2);

  const flag = (name: string, fallback: string) => {
    const i = process.argv.indexOf(`--${name}`);

    return i > 0 ? process.argv[i + 1]! : fallback;
  };

  if (command === "run" && a) {
    const label = flag("label", setting("model"));
    const repeat = Number(flag("repeat", "1"));
    const out = path.join(flag("out", "evals/runs"), label, new Date().toISOString().replace(/[:.]/g, "-"));
    const guidance = readFileSync(path.resolve(import.meta.dir, "../.stamp/review-guidance.md"), "utf8");

    mkdirSync(out, { recursive: true });

    const only = flag("case", "");

    for (const [name, c] of loadCases(a).filter(([n]) => !only || n === only))
      for (let n = 1; n <= repeat; n++) {
        const run = await runCase(name, c, reviewers()[0]!, label, guidance);

        writeFileSync(path.join(out, `${name}-${n}.json`), `${JSON.stringify(run, null, 2)}\n`);
        console.log(`${name} #${n}: ${run.verdict ?? `ERROR ${run.error}`} (${c.expect}) ${run.costUsd === null ? "unpriced" : `$${run.costUsd.toFixed(4)}`} ${(run.durationMs / 1000).toFixed(1)}s`);
      }

    console.log(`runs in ${out}`);
  } else if (command === "score" && a) {
    const cases = new Map(loadCases(flag("cases", "evals/cases")));

    console.table(score(cases, readRuns(a)));
  } else if (command === "export" && a && b) {
    materialize(Case.parse(JSON.parse(readFileSync(path.join(a, "case.json"), "utf8"))), b);
    console.log(`${b}: base on main, the change on pr`);
  } else {
    console.error("usage: eval run <cases> [--label <l>] [--repeat <n>] [--case <name>] [--out <dir>] | eval score <runs> [--cases <dir>] | eval export <case> <dir>");
    process.exit(2);
  }
}
