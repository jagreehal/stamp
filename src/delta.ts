// What changed between the head stamp last reviewed and the head it reviews now. The reviewer gets it as context beside
// the whole diff, without the last verdict.
//
// Stamp merges the earlier version onto the new version's fork point and diffs that tree against the new head, which
// leaves the base branch's own changes out. `merge-tree` writes objects only, and no PR code runs.
import { execFileSync } from "node:child_process";
import { callTimeout } from "./github.ts";

export type Version = { head: string; base: string };

export type Delta = { status: "ok"; diff: string } | { status: "empty" } | { status: "unavailable"; reason: string };

/** The net change from `before` to `after`, both already in the local object store. A failure is a status, never a throw. */
export function incrementalDiff(root: string, before: Version, after: Version): Delta {
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 << 20, timeout: callTimeout(), stdio: ["ignore", "pipe", "pipe"] });
  const forkPoint = (v: Version) => git("merge-base", v.head, v.base).trim();

  try {
    const oldFork = forkPoint(before);
    const newFork = forkPoint(after);
    // On one fork point the heads compare directly. `merge-tree` exits 1 on a conflict, which the catch reports.
    const earlier = oldFork === newFork ? before.head : git("merge-tree", "--write-tree", `--merge-base=${oldFork}`, newFork, before.head).split("\n")[0]!; // SAFETY: split always yields a first element
    const diff = git("diff", "--no-color", "--no-ext-diff", earlier, after.head);

    return diff.trim() ? { status: "ok", diff } : { status: "empty" };
  } catch (e) {
    return { status: "unavailable", reason: e instanceof Error ? e.message.split("\n")[0]! : String(e) }; // SAFETY: as above
  }
}
