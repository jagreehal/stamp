import { expect, test } from "bun:test";
import { anchoredIssues, commentableLines, issueAnchor } from "./inline.ts";

const diff = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,3 +10,4 @@ function a() {",
  " keep",
  "-gone",
  "+new one",
  "+++ an added line that reads like a header",
  " keep",
  "\\ No newline at end of file",
  "diff --git a/old.ts b/moved.ts",
  "similarity index 90%",
  "rename from old.ts",
  "rename to moved.ts",
  "--- a/old.ts",
  "+++ b/moved.ts",
  "@@ -1 +1 @@",
  "-x",
  "+y",
  "diff --git a/gone.ts b/gone.ts",
  "deleted file mode 100644",
  "--- a/gone.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-z",
  "",
].join("\n");

test("a comment fits an added or context line inside a hunk, on the new side's numbering", () => {
  expect([...commentableLines(diff.split("diff --git a/old.ts")[0]!)]).toEqual([10, 11, 12, 13]);
  expect(commentableLines("diff --git a/x b/x\nBinary files differ\n").size).toBe(0);
});

test("the file:line an issue opens with, through the markup a model wraps it in", () => {
  expect(issueAnchor("src/a.ts:12 wrong total")).toEqual({ path: "src/a.ts", line: 12 });
  expect(issueAnchor("`src/a.ts:12`: wrong total")).toEqual({ path: "src/a.ts", line: 12 });
  expect(issueAnchor("**./src/a.ts:12-14** wrong total")).toEqual({ path: "src/a.ts", line: 12 });
  expect(issueAnchor("The total is wrong")).toBeNull();
  expect(issueAnchor("codex: src/a.ts:12 wrong")).toBeNull(); // a dissenter's issue stays in the body
});

test("only an issue on a commentable line is anchored: a rename by its new name, never a line outside a hunk or a deleted file", () => {
  const issues = ["src/a.ts:11 inside", "src/a.ts:9 before the hunk", "moved.ts:1 renamed", "old.ts:1 old name", "gone.ts:1 deleted", "nowhere.ts:1 not in the diff", "no anchor"];

  expect(anchoredIssues(issues, diff)).toEqual([
    { path: "src/a.ts", line: 11, body: "src/a.ts:11 inside" },
    { path: "moved.ts", line: 1, body: "moved.ts:1 renamed" },
  ]);
});
