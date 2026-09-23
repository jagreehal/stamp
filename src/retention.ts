// Approval retention: keep a standing stamp approval when a push left the PR's
// own diff byte-identical (typical case: merging the base branch).
//
// The deliberate exception to dismiss-first. Fail closed on anything ambiguous:
// empty diffs, binary markers, GitHub errors, missing reviewed marker, a failed
// gate, or a PR that moved while it was being checked.
import { compareDiff, listReviews, reviewedShas, unchanged, type PR, type ReviewRecord } from "./github.ts";

const BINARY_MARKER_RE = /^Binary files\b.*differ$/m;

/** Whether the PR's own diff is byte-identical to the one that was approved. */
export function approvedDiffUnchanged(approvedDiff: string, currentDiff: string): boolean {
  if (!approvedDiff.trim() || !currentDiff.trim()) return false;

  if (BINARY_MARKER_RE.test(approvedDiff) || BINARY_MARKER_RE.test(currentDiff)) return false;

  return approvedDiff === currentDiff;
}

export type StandingApproval = { reviewId: number; approvedHead: string; approvedBase: string };

/** Our still-active approval of a head other than `headSha`, with the marker retention needs. A dismissed one lists as DISMISSED. */
export function standingApproval(reviews: ReviewRecord[], headSha: string, botLogin: string): StandingApproval | null {
  for (const r of reviews) {
    if (r.user.login !== botLogin || r.state !== "APPROVED") continue;
    const covered = reviewedShas(r);

    if (!covered || covered.head === headSha) continue; // no marker: fail closed; the live head itself: nothing to retain

    return { reviewId: r.id, approvedHead: covered.head, approvedBase: covered.base };
  }

  return null;
}

const findStandingApproval = (pr: PR, botLogin: string, cwd: string) => standingApproval(listReviews(pr.repo, pr.number, cwd), pr.headSha, botLogin);

/**
 * Retention's last word, called after everything else passed: the PR still has the head and base it
 * was checked at, and the approval being kept is still active. A push after this triggers its own run.
 */
const retentionHolds = (pr: PR, reviewId: number, cwd: string) =>
  unchanged(pr, cwd) && listReviews(pr.repo, pr.number, cwd).some((r) => r.id === reviewId && r.state === "APPROVED");

export type RetentionResult =
  | { kept: true; approval: StandingApproval; pr: PR }
  | { kept: false; reason: "not_posting" | "check_failed" | "rereview_requested" | "withdrawn" | "no_standing" | "compare_failed" | "diff_changed" | "gates_failed" | "pr_moved" };

const github = { findStandingApproval, compareDiff, retentionHolds };

/**
 * Keep a standing approval only when its PR diff is byte-identical to the live one, every gate passes
 * against today's trusted policy, and, checked last, the PR still matches what was checked.
 * Otherwise fail closed to the normal dismiss path.
 */
export function tryRetainApproval(pr: PR, botLogin: string, cwd: string, gatesPass: () => boolean, deps = github): RetentionResult {
  const standing = deps.findStandingApproval(pr, botLogin, cwd);

  if (!standing) return { kept: false, reason: "no_standing" };
  let approvedDiff: string;
  let currentDiff: string;

  try {
    approvedDiff = deps.compareDiff(pr.repo, standing.approvedBase, standing.approvedHead, cwd);
    currentDiff = deps.compareDiff(pr.repo, pr.baseSha, pr.headSha, cwd);
  } catch {
    return { kept: false, reason: "compare_failed" };
  }

  if (!approvedDiffUnchanged(approvedDiff, currentDiff)) return { kept: false, reason: "diff_changed" };

  // A byte-identical diff says nothing about policy tightened since, a new CHANGES_REQUESTED, or a conflict.
  if (!gatesPass()) return { kept: false, reason: "gates_failed" };

  // Last, because every check above read state that a push, retarget or manual dismissal can change.
  if (!deps.retentionHolds(pr, standing.reviewId, cwd)) return { kept: false, reason: "pr_moved" };

  return { kept: true, approval: standing, pr };
}
