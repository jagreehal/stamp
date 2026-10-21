import { expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, story, test } from "executable-stories-bun";
import { reviewedMarker, runMarker, sweepTargets, withoutComments, type PR, type ReviewRecord } from "./github.ts";
import { standingApproval, tryRetainApproval } from "./retention.ts";

const BOT = "github-actions[bot]";

/** One of our verdicts, carrying the markers stamp posts: which head and base it reviewed, and when its run started. */
const verdict = (id: number, state: string, head: string, base: string, started: string): ReviewRecord => ({
  id,
  user: { login: BOT },
  state,
  body: `## stamp: ${state}\n${reviewedMarker(head, base)}\n${runMarker(started)}`,
  commit_id: head,
});

/** A throwaway repository whose commits stand in for a PR's base and pushes. */
function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "stamp-story-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=s@t", "-c", "user.name=s", ...args], { cwd: dir, encoding: "utf8" }).trim();

  git("init", "-q");

  const commit = (content: string, msg: string) => {
    writeFileSync(path.join(dir, "a.ts"), content);
    git("add", "-A");
    git("commit", "-qm", msg);

    return git("rev-parse", "HEAD");
  };

  return { dir, git, commit, diff: (base: string, head: string) => git("diff", `${base}...${head}`) };
}

describe("approval retention", () => {
  test("a push that changes the diff withdraws a stale approval", () => {
    story.init({ ticket: "src/retention.ts", covers: ["src/retention.ts", "src/github.ts"] });

    story.given("stamp approved the PR at its first head");
    const { dir, commit, diff } = repo();
    const base = commit("export const a = 1;\n", "base");
    const approvedHead = commit("export const a = 2;\n", "change a");
    const reviews = [verdict(11, "APPROVED", approvedHead, base, "2026-10-16T09:00:00Z")];

    story.when("the author pushes a commit that changes the PR's own diff");
    const pushedHead = commit("export const a = 3;\n", "change a again");
    // SAFETY: tryRetainApproval only hands `pr` to its deps, which read repo, number and SHAs alone.
    const pr = { repo: "o/r", number: 7, headSha: pushedHead, baseSha: base } as PR;
    let gatesRan = false;

    const result = tryRetainApproval(pr, BOT, dir, () => (gatesRan = true), {
      findStandingApproval: (live, bot) => standingApproval(reviews, live.headSha, bot),
      compareDiff: (_repo, from, to) => diff(from, to),
      retentionHolds: () => true,
    });

    story.then("retention refuses to keep the approval because the diff changed");
    expect(result).toEqual({ kept: false, reason: "diff_changed" });
    expect(gatesRan).toBe(false);

    story.and("the startup sweep dismisses it before the new head is reviewed");
    expect(sweepTargets(reviews, BOT, null)).toEqual([11]);
  });

  test("a base merge keeps the approval only when it left the PR's files alone", () => {
    story.init({ ticket: "src/retention.ts", covers: ["src/retention.ts"] });

    story.given("stamp approved a PR that changes one line of a.ts");
    const { dir, git, commit, diff } = repo();
    const lines = (edit: (l: string[]) => string[]) => edit(Array.from({ length: 12 }, (_, i) => `export const v${i} = ${i};`)).join("\n") + "\n";
    const base = commit(lines((l) => l), "base");
    git("checkout", "-qb", "pr");
    const approvedHead = commit(lines((l) => l.map((v, i) => (i === 10 ? "export const v10 = 100;" : v))), "change v10");
    const reviews = [verdict(31, "APPROVED", approvedHead, base, "2026-10-16T09:00:00Z")];

    const retain = (baseSha: string) => {
      git("checkout", "-q", "pr");
      git("merge", "-q", "--no-edit", baseSha);
      // SAFETY: tryRetainApproval only hands `pr` to its deps, which read repo, number and SHAs alone.
      const pr = { repo: "o/r", number: 7, headSha: git("rev-parse", "HEAD"), baseSha } as PR;

      return tryRetainApproval(pr, BOT, dir, () => true, {
        findStandingApproval: (live, bot) => standingApproval(reviews, live.headSha, bot),
        compareDiff: (_repo, from, to) => diff(from, to),
        retentionHolds: () => true,
      }).kept;
    };

    story.when("the base gains a new file and the author merges it");
    git("checkout", "-q", "-");
    writeFileSync(path.join(dir, "b.ts"), "export const b = 1;\n");
    git("add", "b.ts");
    git("commit", "-qm", "add b");
    const otherFile = git("rev-parse", "HEAD");

    story.then("the PR's diff is byte-identical, so the approval stands");
    expect(retain(otherFile)).toBe(true);

    story.when("the base then edits a.ts, far from the PR's change, and the author merges it");
    git("checkout", "-q", "-");
    const sameFile = commit(lines((l) => ["// header", ...l]), "header");

    story.then("the base edit could change what the PR's line does, so the PR goes back for review");
    expect(retain(sameFile)).toBe(false);
  });

  test("a marker quoted in the review text cannot stand in for the one stamp writes", () => {
    story.init({ ticket: "src/github.ts", covers: ["src/github.ts", "src/retention.ts"] });

    story.given("an approval whose reasoning quotes a reviewed marker for other commits");
    const [real, quoted] = ["a".repeat(40), "f".repeat(40)];
    const approval = verdict(41, "APPROVED", real, real, "2026-10-16T09:00:00Z");
    approval.body = `## stamp: APPROVED\nLooks fine. ${reviewedMarker(quoted, quoted)}\n${approval.body}`;

    story.then("retention reads the marker stamp wrote last");
    expect(standingApproval([approval], "c".repeat(40), BOT)).toEqual({ reviewId: 41, approvedHead: real, approvedBase: real });

    story.and("stamp posts model-written text with no comment delimiter left, nested ones included");
    expect(withoutComments("<!<!---->-- stamp-reviewed:head=f;base=f --<!---->>")).not.toMatch(/<!--|-->/);
  });

  test("a newer refusal supersedes an older approval", () => {
    story.init({ ticket: "src/github.ts", covers: ["src/github.ts"] });

    const head = "c".repeat(40);
    const base = "b".repeat(40);

    story.given("an earlier stamp run approved the live head");
    const approval = verdict(21, "APPROVED", head, base, "2026-10-16T09:00:00Z");

    story.and("a later run refused the same head and posted its refusal as a comment");
    const refusalStarted = "2026-10-16T10:00:00Z";
    const refusal = verdict(22, "COMMENTED", head, base, refusalStarted);

    story.when("the refusing run sweeps after posting");
    const dismissed = sweepTargets([approval, refusal], BOT, head, { keep: refusal.id, olderThan: refusalStarted });

    story.then("the older approval is dismissed, so the refusal governs");
    expect(dismissed).toEqual([approval.id]);

    story.but("an approval from a run that started after the refusal stands");
    const newer = verdict(23, "APPROVED", head, base, "2026-10-16T11:00:00Z");
    expect(sweepTargets([approval, refusal, newer], BOT, head, { keep: refusal.id, olderThan: refusalStarted })).toEqual([approval.id]);
  });
});
