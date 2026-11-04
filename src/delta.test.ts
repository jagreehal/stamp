import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { incrementalDiff } from "./delta.ts";

const dir = mkdtempSync(path.join(tmpdir(), "stamp-delta-"));

const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const commit = (file: string, text: string) => {
  writeFileSync(path.join(dir, file), text);
  git("add", ".");
  git("commit", "-qm", `edit ${file}`);

  return git("rev-parse", "HEAD");
};

const lines = (n: number, change: Record<number, string> = {}) => Array.from({ length: n }, (_, i) => change[i] ?? `line ${i}`).join("\n") + "\n";

let base = "";

beforeAll(() => {
  git("init", "-q", "-b", "main");
  base = commit("a.txt", lines(30));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a new commit on the PR: only that change shows, under the file it belongs to", () => {
  git("checkout", "-qb", "pr1", base);
  const v1 = commit("a.txt", lines(30, { 5: "first version" }));
  const v2 = commit("a.txt", lines(30, { 5: "first version", 20: "second version" }));
  const delta = incrementalDiff(dir, { head: v1, base }, { head: v2, base });

  expect(delta.status).toBe("ok");
  const text = delta.status === "ok" ? delta.diff : "";

  expect(text).toContain("+second version");
  expect(text).toContain("a.txt");
  expect(text).not.toContain("+first version");
});

test("a rebase onto a moved base with no change of its own is empty: base movement never reads as the PR's change", () => {
  git("checkout", "-qb", "pr2", base);
  const v1 = commit("a.txt", lines(30, { 5: "mine" }));

  git("checkout", "-q", "main");
  const moved = commit("b.txt", "base moved\n");

  git("checkout", "-qb", "pr2-rebased", v1);
  git("rebase", "-q", moved);
  const v2 = git("rev-parse", "HEAD");

  expect(incrementalDiff(dir, { head: v1, base }, { head: v2, base: moved })).toEqual({ status: "empty" });
});

test("a head that is gone reports why instead of throwing", () => {
  const missing = "0".repeat(40);
  const delta = incrementalDiff(dir, { head: missing, base }, { head: base, base });

  expect(delta.status).toBe("unavailable");
});

test("a base edit near the PR's lines does not read as the PR's change, and a real change after a rebase does", () => {
  git("checkout", "-qb", "pr3", base);
  const v1 = commit("a.txt", lines(30, { 5: "mine" }));

  git("checkout", "-q", "main");
  const moved = commit("a.txt", lines(30, { 25: "the base edited this" }));

  git("checkout", "-qb", "pr3-rebased", v1);
  git("rebase", "-q", moved);
  const v2 = commit("a.txt", lines(30, { 5: "mine, reworked", 25: "the base edited this" }));
  const delta = incrementalDiff(dir, { head: v1, base }, { head: v2, base: moved });
  const text = delta.status === "ok" ? delta.diff : "";

  expect(text).toContain("+mine, reworked");
  expect(text).toContain("-mine");
  expect(text).not.toContain("+the base edited this");
});

test("an earlier version that conflicts with the new base is unavailable, not a diff full of base changes", () => {
  git("checkout", "-qb", "pr4", base);
  const v1 = commit("a.txt", lines(30, { 7: "mine" }));

  git("checkout", "-q", "main");
  const moved = commit("a.txt", lines(30, { 7: "theirs" }));

  git("checkout", "-qb", "pr4-rebased", moved);
  const v2 = commit("c.txt", "new\n");

  expect(incrementalDiff(dir, { head: v1, base }, { head: v2, base: moved }).status).toBe("unavailable");
});
