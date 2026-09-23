// GitHub I/O through the `gh` CLI. Fetch on one side, post the verdict on the other.
// Every response is parsed against a schema at this boundary, so a shape change in the API
// fails here with a message, not three functions later as an undefined property.
import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { PRFile } from "./policy.ts";

// A hung call must fail rather than wait for the job to be killed: a killed run skips every catch,
// including the one that falls through to dismissing a stale approval.
const CALL_TIMEOUT_MS = 5 * 60_000;

let deadline: number | null = null;

/** Milliseconds the next gh or git call may take: the per-call cap, or what is left of an active budget. */
export function callTimeout(): number {
  if (deadline === null) return CALL_TIMEOUT_MS;
  const left = deadline - Date.now();

  if (left <= 0) throw Object.assign(new Error("time budget exhausted"), { code: "ETIMEDOUT" });

  return Math.min(left, CALL_TIMEOUT_MS);
}

/** A call killed by its timeout, or an exhausted budget. A catch that reads failure as "absent" must rethrow it. */
export const TimedOut = z.object({ code: z.literal("ETIMEDOUT") });

/** Run `fn` with every gh and git call inside it sharing one budget of `ms`. */
export function withBudget<T>(ms: number, fn: () => T): T {
  deadline = Date.now() + ms;

  try {
    return fn();
  } finally {
    deadline = null;
  }
}

const gh = (args: string[], cwd: string) => execFileSync("gh", args, { cwd, encoding: "utf8", maxBuffer: 64 << 20, timeout: callTimeout() });

const call = <T>(schema: z.ZodType<T>, args: string[], cwd: string): T => schema.parse(JSON.parse(gh(args, cwd)));

const paginated = <T>(schema: z.ZodType<T>, endpoint: string, cwd: string): T[] =>
  z
    .array(z.array(schema))
    .parse(JSON.parse(gh(["api", "--paginate", "--slurp", endpoint], cwd)))
    .flat();

const Login = z.object({ login: z.string() });

const RepoView = z.object({ nameWithOwner: z.string(), defaultBranchRef: z.object({ name: z.string() }) });

const Pull = z.object({
  title: z.string(),
  body: z.string().nullable(),
  user: Login,
  author_association: z.string(),
  draft: z.boolean(),
  mergeable_state: z.string(),
  labels: z.array(z.object({ name: z.string() })),
  head: z.object({ sha: z.string(), repo: z.object({ full_name: z.string() }).nullable() }),
  base: z.object({ ref: z.string(), sha: z.string(), repo: z.object({ full_name: z.string() }) }),
});

const File = z.object({ filename: z.string(), previous_filename: z.string().optional(), additions: z.number(), deletions: z.number(), status: z.string() });

const ReviewRow = z.object({ id: z.number(), user: Login, state: z.string(), body: z.string(), commit_id: z.string() });

const InlineRow = z.object({ user: Login, path: z.string(), body: z.string(), position: z.number().nullable() });

const CommentRow = z.object({ user: Login, body: z.string(), created_at: z.string(), reactions: z.record(z.string(), z.union([z.number(), z.string()])).optional() });

const ReactionRow = z.object({ user: Login, content: z.string(), created_at: z.string() });

export type Review = { user: string; state: string; body: string; commit: string; isCurrentHead: boolean };

export type InlineComment = { user: string; path: string; body: string; outdated: boolean };

export type Comment = { user: string; body: string; created: string; reactions: string[] };

export type PR = {
  /** owner/name, as fetchPR read it: every later call on this PR reuses it instead of asking again. */
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  authorAssociation: string;
  isFork: boolean;
  isDraft: boolean;
  mergeable: string;
  baseRef: string;
  defaultBranch: string;
  headSha: string;
  baseSha: string;
  labels: string[];
  files: PRFile[];
  reviews: Review[];
  inline: InlineComment[];
  discussion: Comment[];
  reactions: { user: string; content: string; created: string }[];
  diff: string;
};

export function repoSlug(cwd: string): string {
  return call(z.object({ nameWithOwner: z.string() }), ["repo", "view", "--json", "nameWithOwner"], cwd).nameWithOwner;
}

// GitHub's reaction rollup: counts keyed by emoji name, plus `url` and `total_count`.
const reactionList = (r: Record<string, number | string> | undefined) => {
  const out: string[] = [];

  for (const [k, v] of Object.entries(r ?? {})) if (k !== "total_count" && v !== 0 && Number.isInteger(v)) out.push(`${k}×${v}`);

  return out;
};

export function fetchPR(number: number, cwd: string, exclude: string[] = []): PR {
  const repo = call(RepoView, ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], cwd);
  const base = `repos/${repo.nameWithOwner}`;
  const view = call(Pull, ["api", `${base}/pulls/${number}`], cwd);
  const headSha = view.head.sha;
  const notOurs = <T extends { user: { login: string } }>(rows: T[]) => rows.filter((r) => !exclude.includes(r.user.login));

  return {
    repo: repo.nameWithOwner,
    number,
    title: view.title,
    body: view.body ?? "",
    author: view.user.login,
    authorAssociation: view.author_association,
    isFork: view.head.repo?.full_name !== view.base.repo.full_name,
    isDraft: view.draft,
    mergeable: view.mergeable_state === "dirty" ? "CONFLICTING" : "MERGEABLE",
    baseRef: view.base.ref,
    defaultBranch: repo.defaultBranchRef.name,
    headSha,
    baseSha: view.base.sha,
    labels: view.labels.map((l) => l.name),
    files: paginated(File, `${base}/pulls/${number}/files`, cwd).map((f) => ({
      filename: f.filename,
      previousFilename: f.previous_filename, // a rename out of a sensitive path is still a change to it
      additions: f.additions,
      deletions: f.deletions,
      status: f.status,
    })),
    // Our own earlier verdicts describe an older snapshot and are never independent signal.
    reviews: notOurs(paginated(ReviewRow, `${base}/pulls/${number}/reviews`, cwd)).map((r) => ({
      user: r.user.login,
      state: r.state,
      body: r.body,
      commit: r.commit_id,
      isCurrentHead: r.commit_id === headSha,
    })),
    inline: notOurs(paginated(InlineRow, `${base}/pulls/${number}/comments`, cwd)).map((c) => ({
      user: c.user.login,
      path: c.path,
      body: c.body,
      outdated: c.position === null,
    })),
    discussion: notOurs(paginated(CommentRow, `${base}/issues/${number}/comments`, cwd)).map((c) => ({
      user: c.user.login,
      body: c.body,
      created: c.created_at,
      reactions: reactionList(c.reactions),
    })),
    reactions: paginated(ReactionRow, `${base}/issues/${number}/reactions`, cwd).map((r) => ({
      user: r.user.login,
      content: r.content,
      created: r.created_at,
    })),
    diff: gh(["pr", "diff", String(number)], cwd),
  };
}

export type Verdict = "APPROVED" | "REFUSED" | "ESCALATE" | "ERROR";

/** True when the live PR still has the head, base ref and base sha that were reviewed. */
export function unchanged(pr: PR, cwd: string): boolean {
  const live = call(Pull, ["api", `repos/${pr.repo}/pulls/${pr.number}`], cwd);

  if (live.head.sha === pr.headSha && live.base.ref === pr.baseRef && live.base.sha === pr.baseSha) return true;

  console.log(`PR changed (head ${pr.headSha.slice(0, 7)}→${live.head.sha.slice(0, 7)}, base ${pr.baseRef}@${pr.baseSha.slice(0, 7)}→${live.base.ref}@${live.base.sha.slice(0, 7)})`);

  return false;
}

// Every posted review carries the ISO start time of the run that produced it, so concurrent runs
// can be ordered without shared state: the run that started later owns the newer verdict.
const RUN_MARKER = /<!-- stamp-run:(\S+) -->/;

export const runMarker = (started: string) => `<!-- stamp-run:${started} -->`;

// The full SHAs a review covered. Approval retention compares diffs on exactly these.
const REVIEWED_MARKER = /<!-- stamp-reviewed:head=([0-9a-f]+);base=([0-9a-f]+) -->/;

export const reviewedMarker = (headSha: string, baseSha: string) => `<!-- stamp-reviewed:head=${headSha};base=${baseSha} -->`;

export const listReviews = (repo: string, prNumber: number, cwd: string) => paginated(ReviewRow, `repos/${repo}/pulls/${prNumber}/reviews`, cwd);

export type ReviewRecord = z.infer<typeof ReviewRow>;

/** The head and base one of our reviews covered, from its marker; null for a review posted before the marker existed. */
export function reviewedShas(r: ReviewRecord): { head: string; base: string } | null {
  const m = REVIEWED_MARKER.exec(r.body);

  // SAFETY: both capture groups in REVIEWED_MARKER are mandatory, so a match fills them.
  return m ? { head: m[1]!, base: m[2]! } : null;
}

// Which head one of our reviews covered. GitHub moves a standing approval's `commit_id` forward when
// the branch is updated from its base, so `commit_id` can name a head the review never saw. Our own
// marker is the record; `commit_id` is the fallback only for reviews posted before the marker existed.
const reviewedHead = (r: ReviewRecord) => reviewedShas(r)?.head ?? r.commit_id;

/** Whether the run that posted `r` started after `iso`: the later-started run owns the newer verdict. */
const startedAfter = (r: ReviewRecord, iso: string) => {
  const started = RUN_MARKER.exec(r.body)?.[1];

  return started !== undefined && started > iso;
};

/** Unified diff of base...head on immutable SHAs, via the compare API. Throws on any gh failure. */
export const compareDiff = (repo: string, baseSha: string, headSha: string, cwd: string) =>
  gh(["api", "-H", "Accept: application/vnd.github.diff", `repos/${repo}/compare/${baseSha}...${headSha}`], cwd);

const MergedRow = z.object({ number: z.number(), title: z.string(), url: z.string(), mergedAt: z.string().nullable() });

/** Up to 100 of the most recently merged PRs of the repository at `cwd`. */
export const mergedPRs = (cwd: string) => call(z.array(MergedRow), ["pr", "list", "--state", "merged", "--limit", "100", "--json", "number,title,url,mergedAt"], cwd);

/** Numbers of up to 1000 PRs by `author` merged into `repo`. */
export const mergedPRNumbers = (repo: string, author: string, cwd: string) =>
  new Set(call(z.array(z.object({ number: z.number() })), ["pr", "list", "--repo", repo, "--author", author, "--state", "merged", "--limit", "1000", "--json", "number"], cwd).map((p) => p.number));

export type PostOptions = { cwd: string; botLogin: string; started: string; triggerLabel?: string };

/** True when a run that started after `started` has already posted a verdict of ours on this head. */
function newerVerdictExists(pr: PR, opts: PostOptions): boolean {
  const newer = listReviews(pr.repo, pr.number, opts.cwd).some(
    (r) => r.user.login === opts.botLogin && r.state !== "DISMISSED" && reviewedHead(r) === pr.headSha && startedAfter(r, opts.started),
  );

  if (newer) console.log("a newer stamp run already posted on this head; this run's verdict is stale");

  return newer;
}

/** Approvals are real reviews (count toward branch protection); everything else is a comment. Never request-changes. */
export function postVerdict(pr: PR, verdict: Verdict, body: string, opts: PostOptions): number | null {
  // The diff can change under a finished review two ways: a push moves the head, a retarget moves the
  // base without touching the head. Refuse to post over either; the next run reviews what is live.
  // A newer run may also have already ruled on this exact head; its verdict governs, not this one.
  if (!unchanged(pr, opts.cwd) || newerVerdictExists(pr, opts)) return null;

  // The review is pinned to the reviewed commit, so a push that lands between the check above and
  // this call cannot inherit the approval: GitHub records it against pr.headSha, not the live head.
  const posted = call(
    z.object({ id: z.number() }),
    ["api", "-X", "POST", `repos/${pr.repo}/pulls/${pr.number}/reviews`, "-f", `commit_id=${pr.headSha}`, "-f", `event=${verdict === "APPROVED" ? "APPROVE" : "COMMENT"}`, "-f", `body=${scrub(body)}`],
    opts.cwd,
  );

  // Substantive non-approvals strip the trigger label so a human takes over; ERROR keeps it so the next push retries.
  if (opts.triggerLabel && (verdict === "REFUSED" || verdict === "ESCALATE") && pr.labels.includes(opts.triggerLabel)) {
    execFileSync("gh", ["pr", "edit", String(pr.number), "--remove-label", opts.triggerLabel], { cwd: opts.cwd, stdio: "inherit", timeout: callTimeout() });
  }

  return posted.id;
}

/** Deterministic redaction of anything that could be a credential before it reaches GitHub. */
export function scrub(text: string): string {
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]) {
    const v = process.env[k];

    if (v) text = text.split(v).join("[redacted]");
  }

  return text.replace(/\b(sk-ant-[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[redacted]");
}

export type Sweep = {
  /** The review this run just posted; never dismissed. */
  keep?: number | null;
  /** When set, an approval on the live head is dismissed only if its run started before this ISO time. */
  olderThan?: string;
};

/**
 * A stamp approval must never stand over commits it didn't review. With no options (startup) every
 * active approval of ours goes: fresh judgment is pending and, if a later step crashes, the old
 * approval is already gone. With `olderThan` (terminal sweep) an approval pinned to the live head
 * survives if its run started after ours, because that run's verdict is the newer one; everything
 * off-head or older is dismissed. Needs only the PR number, so it can run before any fallible fetch.
 */
export function dismissOwnApprovals(prNumber: number, botLogin: string, cwd: string, sweep: Sweep = {}): void {
  const repo = repoSlug(cwd);
  const liveHead = sweep.olderThan ? call(Pull, ["api", `repos/${repo}/pulls/${prNumber}`], cwd).head.sha : null;

  for (const r of listReviews(repo, prNumber, cwd)) {
    if (r.user.login !== botLogin || r.state !== "APPROVED" || r.id === sweep.keep) continue;

    if (sweep.olderThan && reviewedHead(r) === liveHead && startedAfter(r, sweep.olderThan)) continue; // a newer run's approval of this same head

    gh(["api", "-X", "PUT", `repos/${repo}/pulls/${prNumber}/reviews/${r.id}/dismissals`, "-f", "message=Superseded by a newer stamp run"], cwd);
  }
}

/**
 * After posting, re-verify the PR is still what was reviewed and that no newer run ruled on this head
 * in the meantime; if either fails, the review just posted is an orphan. An orphaned approval MUST
 * come down, so a failed dismissal propagates and fails the run loudly: a silent 503 here would leave
 * an approval standing over code nobody reviewed. A comment cannot be dismissed on GitHub and grants
 * nothing, so a stale one is logged and left.
 */
export function reconcilePosted(pr: PR, reviewId: number, verdict: Verdict, opts: PostOptions): void {
  if (unchanged(pr, opts.cwd) && !newerVerdictExists(pr, opts)) return;

  if (verdict !== "APPROVED") {
    console.log("the comment just posted is stale; it grants nothing and stays");

    return;
  }

  console.log("dismissing the approval just posted");
  gh(["api", "-X", "PUT", `repos/${pr.repo}/pulls/${pr.number}/reviews/${reviewId}/dismissals`, "-f", "message=Superseded while stamp was posting"], opts.cwd);
}
