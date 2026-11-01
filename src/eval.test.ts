import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Case, changedFiles, found, loadCases, materialize, score, type Run } from "./eval.ts";
import { diffCut } from "./reviewer.ts";

const cases = new Map(loadCases(path.resolve(import.meta.dir, "../evals/cases")));

const tmp = mkdtempSync(path.join(tmpdir(), "stamp-eval-test-"));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("every case parses, and a block case names the bugs that make it one", () => {
  expect(cases.size).toBeGreaterThanOrEqual(7);

  for (const [name, c] of cases) expect(c.expect === "approve" ? c.bugs.length === 0 : c.bugs.length > 0, name).toBe(true);
});

test("the truncated case puts its bug past the prompt limit, under git's quoted name, where only read_diff reaches it", () => {
  const { diff, files } = materialize(cases.get("truncated-bug")!, path.join(tmp, "truncated"));
  const cut = diffCut(diff)!;

  expect(diff).toContain('diff --git "a/src/caf\\303\\251.ts"');
  expect([...cut.omitted.keys()]).toEqual(["fixtures/data.csv", "src/café.ts"]);
  // Most of the fixture reached the prompt, so the reviewer reads only its tail.
  expect(cut.shown).toBeGreaterThan(5000);
  // File names as GitHub's API gives them: decoded, while the diff keeps git's quoting.
  expect(files.map((f) => f.filename)).toEqual(["fixtures/data.csv", "src/café.ts"]);
});

test("files come back as GitHub lists them: a rename keeps both paths, and statuses follow name-status", () => {
  const c = Case.parse({
    title: "t",
    base: { "old.ts": "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n", "gone.ts": "x\n", "keep.ts": "1\n" },
    head: { "old.ts": null, "new.ts": "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n", "gone.ts": null, "keep.ts": "2\n", "café.ts": "y\n" },
    expect: "approve",
  });

  const { files } = materialize(c, path.join(tmp, "rename"));

  expect(files).toEqual([
    { filename: "café.ts", additions: 1, deletions: 0, status: "added" },
    { filename: "gone.ts", additions: 0, deletions: 1, status: "removed" },
    { filename: "keep.ts", additions: 1, deletions: 1, status: "modified" },
    { filename: "new.ts", previousFilename: "old.ts", additions: 0, deletions: 0, status: "renamed" },
  ]);
  // A path holding a tab keeps it: numstat splits at the first two tabs only.
  const { files: tabbed } = materialize(Case.parse({ title: "t", base: { "keep.ts": "1\n" }, head: { "a\tb.ts": "x\n" }, expect: "approve" }), path.join(tmp, "tab"));

  expect(tabbed).toEqual([{ filename: "a\tb.ts", additions: 1, deletions: 0, status: "added" }]);
  // Binary numstat ("-\t-\t") counts no lines.
  expect(changedFiles("-\t-\timg.png\0", "M\0img.png\0")).toEqual([{ filename: "img.png", additions: 0, deletions: 0, status: "modified" }]);
});

test("a case path that leaves its repository, or reaches into .git, never parses", () => {
  for (const p of ["../x", "/etc/passwd", "a/../../x", ".git/hooks/post-commit", "src/.GIT/config", "C:\\x", "a\\..\\..\\x", ""])
    expect(Case.safeParse({ title: "t", base: { [p]: "x" }, head: {}, expect: "approve" }).success, p).toBe(false);

  expect(Case.safeParse({ title: "t", base: { "src/.gitignore": "x" }, head: { "a/b.ts": null }, expect: "approve" }).success).toBe(true);
});

test("an issue finds a bug when it names the bug's file and matches one of its patterns", () => {
  const c = cases.get("weakened-test")!;

  expect(found(c, ["src/discount.test.ts:4 asserts toBeGreaterThanOrEqual(0), which cannot fail"])).toEqual(["assertion-cannot-fail"]);
  expect(found(c, ["discount.ts:1 changes the rate to 0.15 and the boundary to > 100"])).toEqual(["rate-changed"]);
  // The right words on the wrong file find nothing.
  expect(found(c, ["src/other.ts: skip"])).toEqual([]);
});

test("scores count unsafe approvals, false holds, recall, unmatched issues, cost and median latency per label", () => {
  const run = (over: Partial<Run>): Run => ({ case: "off-by-one", label: "a", verdict: "REFUSE", issues: [], costUsd: 0.01, durationMs: 1000, ...over });

  const runs = [
    run({ issues: ["src/window.ts:3 loops with <= xs.length, reading past the end"] }),
    run({ verdict: "APPROVE", durationMs: 3000 }),
    run({ case: "truncated-bug", verdict: "ESCALATE", model_verdict: "APPROVE", durationMs: 2500 }),
    run({ case: "clean-docs", verdict: "ESCALATE", issues: ["README.md: wording"], durationMs: 2000 }),
    run({ case: "clean-rename", verdict: null, error: "timeout", costUsd: null }),
    run({ label: "b", verdict: "APPROVE", case: "clean-docs" }),
  ];

  expect(score(cases, runs)).toEqual([
    { label: "a", runs: 5, errors: 1, unsafe_approvals: 1, false_holds: 1, bug_recall: 1 / 3, unmatched_issues: 1, held_by_stamp: 1, cost_usd: null, median_ms: 2000 },
    { label: "b", runs: 1, errors: 0, unsafe_approvals: 0, false_holds: 0, bug_recall: null, unmatched_issues: 0, held_by_stamp: 0, cost_usd: 0.01, median_ms: 1000 },
  ]);
});
