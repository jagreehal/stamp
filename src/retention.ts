// Approval retention: keep a standing stamp approval when a push left the PR's
// own diff byte-identical (typical case: merging the base branch).
//
// The deliberate exception to dismiss-first. Fail closed on anything ambiguous:
// empty diffs, binary markers, GitHub errors, missing reviewed marker, a failed
// gate, or a PR that moved while it was being checked.
import { compareDiff, findStandingApproval, retentionHolds, type PR, type StandingApproval } from "./github.ts";

const BINARY_MARKER_RE = /^Binary files\b.*differ$/m;

/** Whether the PR's own diff is byte-identical to the one that was approved. */
export function approvedDiffUnchanged(approvedDiff: string, currentDiff: string): boolean {
  if (!approvedDiff.trim() || !currentDiff.trim()) return false;

  if (BINARY_MARKER_RE.test(approvedDiff) || BINARY_MARKER_RE.test(currentDiff)) return false;

  return approvedDiff === currentDiff;
}

export type RetentionResult =
  | { kept: true; approval: StandingApproval }
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
    approvedDiff = deps.compareDiff(standing.approvedBase, standing.approvedHead, cwd);
    currentDiff = deps.compareDiff(pr.baseSha, pr.headSha, cwd);
  } catch {
    return { kept: false, reason: "compare_failed" };
  }

  if (!approvedDiffUnchanged(approvedDiff, currentDiff)) return { kept: false, reason: "diff_changed" };

  // A byte-identical diff says nothing about policy tightened since, a new CHANGES_REQUESTED, or a conflict.
  if (!gatesPass()) return { kept: false, reason: "gates_failed" };

  // Last, because every check above read state that a push, retarget or manual dismissal can change.
  if (!deps.retentionHolds(pr, standing.reviewId, cwd)) return { kept: false, reason: "pr_moved" };

  return { kept: true, approval: standing };
}
