// Stacked PRs and wrong bases. A PR's base...head diff is what lands when it merges, which is right for a
// lone PR and wrong for two common shapes: a PR stacked on another open PR into the same base (its diff
// carries the parent's change), and a PR branched from one long-lived branch but opened against another
// (its diff carries everything the two branches differ by). Everything here is git ancestry on immutable
// SHAs; nothing a PR author writes (body, title, "stacked on #n") is read.
import path from "node:path";
import { isOurs, reviewedShas, type ReviewRecord } from "./github.ts";
import { TRUSTED_ASSOCIATIONS } from "./policy.ts";

export type StackDeps = {
  /** `git rev-list --topo-order <head> ^<base>`: this PR's commits, newest first. */
  commits: (head: string, base: string) => string[];
  /** How many of this PR's commits are not on `branch` (a remote-tracking ref). */
  notOn: (head: string, base: string, branch: string) => number;
  /** Remote branch names, `git ls-remote --heads origin`. */
  branches: () => string[];
  /** Fetch these branches into their remote-tracking refs. */
  fetch: (branches: string[]) => void;
};

export type WrongBase = { branch: string; on: number; total: number };

/**
 * The long-lived branch this PR's commits mostly already sit on, when that is not its base: it was branched
 * from there and opened against the wrong target. A branch holding every commit of the PR is not flagged
 * (a backport), and a PR whose head is itself a long-lived branch is a promotion, so it never flags.
 */
export function wrongBase(pr: { headSha: string; baseSha: string; baseRef: string; headRef: string }, longLived: string[], deps: StackDeps): WrongBase | null {
  if (!longLived.length || longLived.some((g) => path.matchesGlob(pr.headRef, g))) return null;
  const candidates = deps.branches().filter((b) => b !== pr.baseRef && b !== pr.headRef && longLived.some((g) => path.matchesGlob(b, g)));

  if (!candidates.length) return null;
  const total = deps.commits(pr.headSha, pr.baseSha).length;

  if (total < 2) return null;
  deps.fetch(candidates);
  let worst: WrongBase | null = null;

  for (const branch of candidates) {
    const off = deps.notOn(pr.headSha, pr.baseSha, branch);
    const on = total - off;

    if (off > 0 && on * 2 > total && (!worst || on > worst.on)) worst = { branch, on, total };
  }

  return worst;
}

/**
 * The nearest open PR into the same base whose head is one of this PR's own commits: the parent this PR is
 * stacked on. Its head being in base..head is the whole test, so a PR already merged into the base, or one
 * that only shares history, never counts.
 */
export function stackedParent(pr: { number: number; headSha: string; baseSha: string }, open: { number: number; headRefOid: string }[], deps: Pick<StackDeps, "commits">): { parent: number; parentHead: string } | null {
  const others = open.filter((p) => p.number !== pr.number && p.headRefOid !== pr.headSha);

  if (!others.length) return null;
  const order = deps.commits(pr.headSha, pr.baseSha);
  let best: { parent: number; parentHead: string; at: number } | null = null;

  for (const p of others) {
    const at = order.indexOf(p.headRefOid);

    if (at >= 0 && (!best || at < best.at)) best = { parent: p.number, parentHead: p.headRefOid, at };
  }

  return best && { parent: best.parent, parentHead: best.parentHead };
}

/**
 * Whether a PR is approved on `head` by someone whose approval carries authority: a reviewer with write access
 * (OWNER, MEMBER, COLLABORATOR) or stamp itself. On a public repository anyone can submit an APPROVED review,
 * so an outsider's never counts. A stamp approval counts for the head its reviewed marker names, never its
 * commit_id. Some trusted reviewer's latest decision approves exactly that commit, and no
 * reviewer's latest decision, trusted or not, requests changes. A COMMENTED review is not a decision.
 */
export function approvedOn(reviews: ReviewRecord[], head: string, botLogin: string): boolean {
  const latest = new Map<string, ReviewRecord>();

  for (const r of reviews) if (r.state !== "COMMENTED" && r.state !== "PENDING") latest.set(r.user.login, r);
  const decisions = [...latest.values()];
  // The head an approval covers. GitHub moves commit_id forward when a branch is updated from its base, so a
  // stamp approval covers only the head its reviewed marker names, and one without a marker covers none.
  const covers = (r: ReviewRecord) => (isOurs(r, botLogin) ? (reviewedShas(r)?.head ?? null) : TRUSTED_ASSOCIATIONS.has(r.author_association ?? "") ? r.commit_id : null);

  return decisions.some((r) => r.state === "APPROVED" && covers(r) === head) && !decisions.some((r) => r.state === "CHANGES_REQUESTED");
}
