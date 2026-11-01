import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { changedSymbols, formatLeads, leadsAt, relatedTests } from "./leads.ts";

const dir = mkdtempSync(path.join(tmpdir(), "stamp-leads-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const diff = [
  "diff --git a/src/total.ts b/src/total.ts",
  "--- a/src/total.ts",
  "+++ b/src/total.ts",
  "@@ -1,3 +1,3 @@",
  "-export function total(xs: number[]) {",
  "+export async function total(xs: number[]) {",
  "+export const VAT_RATE = 0.2;",
  "+  const x = 1;",
  "diff --git a/app.py b/app.py",
  "--- a/app.py",
  "+++ b/app.py",
  "@@ -1 +1 @@",
  "+def parse_amount(s):",
  "+export const ab = 1;",
  "",
].join("\n");

test("the names the diff's hunk lines declare, TS exports and Python defs; locals and short names are not leads", () => {
  expect(changedSymbols(diff)).toEqual(["total", "VAT_RATE", "parse_amount"]);
  // A file header is not a declaration, even when its path reads like one.
  expect(changedSymbols("diff --git a/x b/x\n--- a/export const evil\n+++ b/x\n")).toEqual([]);
});

test("tests are matched by the source file's stem, in each language's convention", () => {
  const tracked = ["src/total.ts", "src/total.test.ts", "src/__tests__/total.ts", "tests/test_app.py", "pkg/total_test.go", "src/totals.test.ts", "src/total.md"];

  expect(relatedTests("src/total.ts", tracked)).toEqual(["src/total.test.ts", "src/__tests__/total.ts"]);
  expect(relatedTests("app.py", tracked)).toEqual(["tests/test_app.py"]);
  expect(relatedTests("pkg/total.go", tracked)).toEqual(["pkg/total_test.go"]);
  // A stem holding regex characters is matched literally.
  expect(relatedTests("src/a+b.ts", ["src/aab.test.ts", "src/a+b.test.ts"])).toEqual(["src/a+b.test.ts"]);
});

test("over a checkout: callers outside the PR, the source's tests, and a file with none says so", () => {
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });

  git("init", "-q");
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src/total.ts"), "export async function total() {}\nexport const VAT_RATE = 0.2;\n");
  writeFileSync(path.join(dir, "src/total.test.ts"), "import { total } from './total';\n");
  writeFileSync(path.join(dir, "src/cart.ts"), "import { total, VAT_RATE } from './total';\n");
  writeFileSync(path.join(dir, "app.py"), "def parse_amount(s): pass\n");
  writeFileSync(path.join(dir, "CHANGELOG.md"), "total and VAT_RATE changed.\n");
  git("add", ".");

  const leads = leadsAt(dir, diff, ["src/total.ts", "app.py"])!;

  expect(leads.symbols).toEqual([
    { name: "total", callers: ["src/cart.ts", "src/total.test.ts"] },
    { name: "VAT_RATE", callers: ["src/cart.ts"] },
    { name: "parse_amount", callers: [] },
  ]);
  expect(formatLeads(leads, (s) => s)).toEqual([
    "total: named in src/cart.ts, src/total.test.ts",
    "VAT_RATE: named in src/cart.ts",
    "parse_amount: named nowhere outside this PR",
    "src/total.ts: tests in src/total.test.ts",
    "app.py: no test file matches its name",
  ]);
  // A non-ASCII path, which git quotes without -z: the changed file is not its own caller, and its test is found.
  writeFileSync(path.join(dir, "src/café.ts"), "export function price() {}\n");
  writeFileSync(path.join(dir, "src/café.test.ts"), "import { price } from './café';\n");
  git("add", ".");
  const cafe = leadsAt(dir, "diff --git a/x b/x\n@@ -0,0 +1 @@\n+export function price() {}\n", ["src/café.ts"])!;

  expect(cafe.symbols).toEqual([{ name: "price", callers: ["src/café.test.ts"] }]);
  expect(cafe.sources).toEqual([{ file: "src/café.ts", tests: ["src/café.test.ts"] }]);

  // Not a git checkout: no leads, never an error.
  expect(leadsAt(path.join(dir, "missing"), diff, [])).toBeNull();
});
