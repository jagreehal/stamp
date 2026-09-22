#!/usr/bin/env bun
// stamp <pr-number> [--dry-run] [--post] [--label <name>] [--json <path>] [-v]
// stamp init   copies .stamp/ and the workflow into the current repo
// stamp digest [--since <hours>]   posts a Slack summary of recent stamp-approved merges
//
// Pipeline: (retention?) → retract stale approvals → fetch → gates → (wait for
// in-flight reviewer bots) → familiarity → LLM review → verdict → post → sweep.
// The verdict is the output; --post puts it on GitHub as a real approval or a comment.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { computeFamiliarity, ensureFullHistory, familiarityEvidence, type AuthorFamiliarity } from "./familiarity.ts";
import { dismissOwnApprovals, fetchPR, listReviews, mergedPRs, postVerdict, reconcilePosted, repoSlug, reviewedMarker, runMarker, type PR, type Verdict } from "./github.ts";
import {
  DEFAULTS_DIR,
  detectOwnership,
  inFlightBots,
  loadGuidance,
  loadPolicy,
  manifestScriptEdits,
  manifestsWithoutLockfile,
  parseCodeowners,
  readTrusted,
  resolveSizeOverrides,
  runGates,
  scrutinyFlags,
  titleFlags,
  type Gate,
  type Policy,
  type ScopeBudget,
} from "./policy.ts";
import { tryRetainApproval, type RetentionResult } from "./retention.ts";
import { BACKENDS, combine, review, secondOpinionNeeded, type LLMVerdict, type Opinion } from "./reviewer.ts";
import { flagged, riskSignals, type Signals } from "./signals.ts";

const VERSION = "0.1.0";

const STARTED = new Date().toISOString(); // stamped into every posted review so concurrent runs can order themselves

const VERDICT_OF: Record<LLMVerdict["verdict"], Verdict> = { APPROVE: "APPROVED", REFUSE: "REFUSED", ESCALATE: "ESCALATE" };

const STALE_EYES_MS = 45 * 60_000; // a bot 👀 older than this is a crashed reviewer, not an in-flight one

const REVIEWER_WAIT_MS = 5 * 60_000; // how long to hold for an in-flight reviewer bot before reviewing without it

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    post: { type: "boolean", default: false },
    label: { type: "string" },
    json: { type: "string" },
    verbose: { type: "boolean", short: "v", default: false },
    since: { type: "string" }, // digest: lookback in hours, default 24
  },
});

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

const git = (...args: string[]) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

if (positionals[0] === "init") {
  // Existing files are never overwritten: the repo's policy is the repo's.
  for (const rel of [".stamp/policy.yml", ".stamp/review-guidance.md", ".github/workflows/stamp.yml", ".github/workflows/stamp-digest.yml"]) {
    const dest = path.join(repoRoot, rel);
    const src = path.join(DEFAULTS_DIR, rel.startsWith(".github") ? `templates/${path.basename(rel)}` : rel);

    if (existsSync(dest)) {
      console.log(`kept    ${rel}`);
      continue;
    }

    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    console.log(`created ${rel}`);
  }

  console.log("\nNext: add the ANTHROPIC_API_KEY secret, enable 'Allow GitHub Actions to create and approve pull requests', merge.");
  console.log("Optional digest: add the STAMP_SLACK_WEBHOOK secret; the digest stays off without it.");
  process.exit(0);
}

if (positionals[0] === "digest") {
  await runDigest();
  process.exit(0);
}

// A dry run never touches GitHub, whatever else was passed.
if (opts["dry-run"]) opts.post = false;

const prNumber = Number(positionals[0]);

if (!prNumber) {
  console.error("usage: stamp <pr-number> [--dry-run] [--post] [--label <name>] [--json <path>] [-v]\n       stamp init\n       stamp digest [--since <hours>]");
  process.exit(2);
}

const me = process.env.STAMP_BOT_LOGIN || whoami(); // the login our verdicts post under; excluded from the prompt and swept for stale approvals

opts.label ||= process.env.STAMP_LABEL || undefined;

let retention: RetentionResult = { kept: false, reason: "not_posting" };

// Retention is the deliberate exception to dismiss-first. It keeps a standing approval, and skips the
// review, only when everything a fresh run would check still holds: the trigger label, not a draft, a
// byte-identical PR diff, every gate against today's trusted policy, and finally a PR that has not
// moved since. Anything ambiguous or failing falls through to dismiss (fail closed). A `/stamp`
// comment is an explicit request for a fresh review, so it never retains.
if (opts.post) {
  try {
    const early = fetchPR(prNumber, repoRoot, [me]);

    if (process.env.GITHUB_EVENT_NAME === "issue_comment") retention = { kept: false, reason: "rereview_requested" };
    else if ((opts.label && !early.labels.includes(opts.label)) || early.isDraft) retention = { kept: false, reason: "withdrawn" };
    else {
      retention = tryRetainApproval(early, me, repoRoot, () => {
        fetchRefs(early);
        const trustedRef = `origin/${early.defaultBranch}`;

        return gatesFor(early, loadPolicy(repoRoot, trustedRef), trustedRef).gated.gates.every((g) => g.passed);
      });
    }

    if (retention.kept) {
      console.log(`retention: keeping approval #${retention.approval.reviewId}; PR diff unchanged`);

      const evidence = {
        stamp: VERSION,
        pr: early.number,
        head: early.headSha,
        base: `${early.baseRef}@${early.baseSha}`,
        author: early.author,
        title: early.title,
        retention: { status: "kept" as const, reviewId: retention.approval.reviewId },
        verdict: "APPROVED" as const,
        duration_ms: Date.now() - Date.parse(STARTED),
        at: new Date().toISOString(),
      };

      if (opts.json) writeFileSync(opts.json, JSON.stringify(evidence, null, 2));
      process.exit(0);
    }

    console.log(`retention: ${retention.reason}; dismissing and reviewing`);
  } catch (e) {
    console.log(`retention check failed (${e instanceof Error ? e.message : e}); dismissing`);
    retention = { kept: false, reason: "check_failed" };
  }

  // The stale-approval invariant: no stamp approval may stand over commits it didn't review.
  // Fail-closed: if any later step crashes, the prior approval is already gone.
  dismissOwnApprovals(prNumber, me, repoRoot);
}

let pr = fetchPR(prNumber, repoRoot, [me]);

const skip = (why: string) => {
  console.log(`${why}; nothing to review`);
  process.exit(0);
};

if (opts.label && !pr.labels.includes(opts.label)) skip(`label "${opts.label}" not present`);

if (pr.isDraft) skip("PR is a draft");

// Make sure both ends of the diff exist locally, then review from a tree that IS the reviewed head.
// The current checkout may be the default branch, a stale copy of the PR, or dirty: reading source
// from it would mix this PR's diff with unrelated code. CI checks out the head SHA, so the worktree
// is only created when needed.
// The default branch is fetched explicitly, into its remote-tracking ref, because policy is read
// from there: a stacked PR's base is another feature branch, and a local clone's origin/main can be
// weeks behind a tightened deny list.
try {
  fetchRefs(pr);
} catch (e) {
  // Offline local runs can go on with what is already here. A posting run cannot: stale policy or a
  // stale head would make the verdict wrong, and the startup sweep has already retracted the old one.
  if (opts.post) throw new Error(`could not fetch the PR head and trusted refs; refusing to post: ${e instanceof Error ? e.message : e}`);
}

const trustedRef = `origin/${pr.defaultBranch}`;

const policy = loadPolicy(repoRoot, trustedRef);

// Reviewer bots leave 👀 while they work and swap it for a verdict when they post; their findings
// belong in the prompt, so hold for them. Bounded, and never terminal: nothing re-triggers the
// workflow when a bot finishes, so a run that stopped here would never come back. Greptile reacts
// within seconds of a push, which is faster than this run reaches this line every time.
const inFlight = () => inFlightBots(pr.reactions, policy.reviewer_bots, STALE_EYES_MS);

const waitUntil = Date.now() + REVIEWER_WAIT_MS;

while (inFlight().length && Date.now() < waitUntil) {
  console.log(`waiting for ${inFlight().join(", ")} to finish reviewing`);
  await Bun.sleep(20_000);
  const fresh = fetchPR(prNumber, repoRoot, [me]);

  if (fresh.headSha !== pr.headSha) break; // a new head: this run is superseded, and postVerdict will refuse to post

  pr = fresh; // their comments are part of the review input, so take the refreshed PR, not just the reactions
}

if (inFlight().length) console.log(`reviewing without ${inFlight().join(", ")}: still going after ${REVIEWER_WAIT_MS / 60_000}m`);

const exploreRoot = checkoutAtHead(pr.headSha);

const codeowners = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"].map((f) => readTrusted(repoRoot, f, trustedRef)).find((t) => t !== null) ?? null;

const ownership = codeowners !== null ? detectOwnership(parseCodeowners(codeowners), pr.files.map((f) => f.filename), pr.author) : undefined;

const { manifests, sizeBudgets, gated } = gatesFor(pr, policy, trustedRef);

const gateVerdict = gated.gates.every((g) => g.passed) ? "PASSED" : "DENIED";

const flags = titleFlags(policy, pr.title, gated.denied);

const scrutiny = scrutinyFlags(policy, pr.files.map((f) => f.filename));

// Jev risk signals: advisory, before the reviewer, skipped without TYPESAFE_API_KEY. A failure here
// loses a signal, not the review, so it is logged and the run goes on without it.
let signals: Signals | null = null;

try {
  signals = gateVerdict === "PASSED" ? await riskSignals(pr) : null;
} catch (e) {
  console.error(`risk signals unavailable: ${e instanceof Error ? e.message : e}`);
}

const signalFlags = signals ? flagged(signals) : [];

// Familiarity: judgment only. Absence (gh failure / no policy) leaves the prompt unchanged.
let familiarity: AuthorFamiliarity | null = null;

if (gateVerdict === "PASSED" && policy.familiarity) {
  try {
    if (!ensureFullHistory(repoRoot)) console.error("familiarity unavailable: could not fetch full history into the shallow checkout");

    familiarity = computeFamiliarity({
      authorLogin: pr.author,
      diff: pr.diff,
      baseSha: pr.baseSha,
      headSha: pr.headSha,
      repo: repoSlug(repoRoot),
      repoRoot: exploreRoot,
      trustedRef,
      thresholds: policy.familiarity,
    });
  } catch (e) {
    console.error(`familiarity unavailable: ${e instanceof Error ? e.message : e}`);
  }
}

for (const g of gated.gates) console.log(`${g.passed ? "✓" : "✗"} ${g.gate}: ${g.message}`);

if (signals) console.log(`  risk signals: ${signalFlags.length ? signalFlags.map((f) => `${f} ${signals[f].toFixed(2)}`).join(", ") : "none flagged"}`);

if (familiarity) console.log(`  familiarity: ${familiarity.band} (${familiarity.blame_overlap_pct.toFixed(0)}% blame, ${familiarity.prior_prs_in_paths} prior PRs)`);

if (flags.length) console.log(`  title scrutiny flags: ${flags.join(", ")}`);

for (const f of scrutiny) console.log(`  scrutiny ${f.name}: ${f.files.join(", ")}`);

if (sizeBudgets.invalid_folder_files.length) console.log(`  invalid AGENT_APPROVALS.md (ignored): ${sizeBudgets.invalid_folder_files.join(", ")}`);

let verdict: Verdict;

let llm: LLMVerdict | null = null;

let opinion: Opinion | null = null;

let body: string;

if (opts["dry-run"]) {
  console.log(`gate verdict: ${gateVerdict} (dry run, no LLM call)`);
  process.exit(gateVerdict === "PASSED" ? 0 : 1);
} else if (gateVerdict === "DENIED") {
  verdict = "REFUSED";
  body = `Gates denied: ${gated.gates.filter((g) => !g.passed).map((g) => g.message).join("; ")}. A human reviewer has to take it from here.`;
} else {
  const [primary, second] = BACKENDS;

  const input = {
    pr,
    gates: gated.gates,
    gateVerdict,
    tier: [gated.tier, gated.sub].filter(Boolean).join(" / "),
    titleFlags: flags,
    manifests,
    scrutiny,
    ownership,
    signals,
    familiarity,
  } as const;

  const guidance = loadGuidance(repoRoot, trustedRef);

  try {
    llm = await review(primary!, input, guidance, exploreRoot, opts.verbose);
    verdict = VERDICT_OF[llm.verdict];
    body = llm.reasoning;

    // A second opinion from a different family, only where it can change the outcome. The second
    // reviewer never sees the first verdict, so it cannot anchor on it. Agreement is the independent
    // assurance the guidance asks for in risky territory; disagreement escalates with both reasonings.
    if (second && secondOpinionNeeded(llm, flags.length + scrutiny.length + manifests.length + signalFlags.length > 0)) {
      opinion = { backend: second, ...(await review(second, input, guidance, exploreRoot, opts.verbose)) };
      const combined = combine(primary!, llm, opinion);
      verdict = VERDICT_OF[combined.verdict];
      llm = combined.llm;
      body = llm.reasoning;
    }
  } catch (e) {
    verdict = "ERROR";
    body = `Review failed before reaching a verdict: ${String(e instanceof Error ? e.message : e).split("\n")[0]}`;
  }
}

console.log(`\n${verdict}: ${body}`);

if (llm?.issues.length) console.log(llm.issues.map((i) => `  - ${i}`).join("\n"));

if (llm?.next_steps) console.log(`next: ${llm.next_steps}`);

if (opinion) console.log(`second opinion (${opinion.backend}): ${opinion.verdict} — ${opinion.reasoning}`);

const folderGrants = (kind: "max_files" | "max_lines", scopes: ScopeBudget[]) =>
  scopes.flatMap((s) => (s.path === null ? [] : [{ path: s.path, kind, ceiling: s.ceiling, files: s.files.length }]));

const evidence = {
  stamp: VERSION,
  pr: pr.number,
  head: pr.headSha,
  base: `${pr.baseRef}@${pr.baseSha}`,
  author: pr.author,
  title: pr.title,
  tier: gated.tier,
  sub: gated.sub,
  denied: gated.denied,
  titleFlags: flags,
  scrutiny,
  gates: gated.gates,
  ownership: ownership && { ...ownership, owners: [...ownership.owners] },
  signals,
  signalFlags,
  familiarity: familiarityEvidence(familiarity),
  size_overrides: [...folderGrants("max_files", sizeBudgets.file_scopes), ...folderGrants("max_lines", sizeBudgets.line_scopes)],
  retention: { status: "dismissed" as const, reason: retention.reason },
  backends: BACKENDS,
  llm,
  opinion,
  verdict,
  duration_ms: Date.now() - Date.parse(STARTED),
  at: new Date().toISOString(),
};

if (opts.json) writeFileSync(opts.json, JSON.stringify(evidence, null, 2));

if (opts.post) {
  const post = { cwd: repoRoot, botLogin: me, started: STARTED, triggerLabel: opts.label };
  const posted = postVerdict(pr, verdict, renderBody(pr, verdict, body, llm, opinion, gated.gates), post);
  // Terminal sweep: an older run's approval can land after this run's startup sweep. Dismiss every
  // approval of ours that is off the live head, or on it but from a run that started before this
  // one; a run that started later owns the newer verdict and its approval is kept. Then confirm the
  // PR is still what we reviewed.
  dismissOwnApprovals(prNumber, me, repoRoot, { keep: posted, olderThan: STARTED });

  if (posted !== null) reconcilePosted(pr, posted, verdict, post);
}

process.exit(verdict === "APPROVED" ? 0 : 1);

function whoami(): string {
  try {
    return JSON.parse(execFileSync("gh", ["api", "user"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).login;
  } catch {
    return "github-actions[bot]"; // GITHUB_TOKEN has no user endpoint; this is what its reviews post as
  }
}

/** The current checkout if it is exactly `sha` and clean; otherwise a detached worktree at `sha`, removed on exit. */
function checkoutAtHead(sha: string): string {
  if (git("rev-parse", "HEAD") === sha && git("status", "--porcelain") === "") return repoRoot;
  const dir = mkdtempSync(path.join(tmpdir(), "stamp-head-"));
  git("worktree", "add", "--detach", "-q", dir, sha);
  process.on("exit", () => {
    try {
      git("worktree", "remove", "--force", dir);
    } catch {
      /* best effort */
    }
  });

  if (opts.verbose) console.error(`reviewing from worktree ${dir} at ${sha.slice(0, 7)}`);

  return dir;
}

/**
 * The findings as a prompt the author can hand straight to whatever agent wrote the PR. Most PRs
 * stamp reviews are agent-written, and the fix loop is where a reviewer either saves time or wastes
 * it. Five backticks so the block survives fences inside the reasoning, and the rules line is here
 * because an agent told only "make the reviewer happy" will reach for the test file first.
 */
function agentPrompt(pr: PR, verdict: Verdict, reasoning: string, llm: LLMVerdict): string[] {
  return [
    "<details><summary>🤖 Fix with a coding agent</summary>",
    "",
    "`````markdown",
    `Address this review of PR #${pr.number}, on head ${pr.headSha.slice(0, 7)}.`,
    "",
    `Verdict: ${verdict} — ${reasoning}`,
    "",
    "Issues to fix:",
    ...llm.issues.map((i, n) => `${n + 1}. ${i}`),
    ...(llm.next_steps ? ["", `Next step the reviewer asked for: ${llm.next_steps}`] : []),
    "",
    "Fix the cause, not the symptom. Do not skip or weaken a test, loosen a lint rule, widen an",
    "ignore pattern or relax a type check to get past this review: that is itself a refusal.",
    "Push to the PR branch when done and stamp reviews the new head.",
    "`````",
    "",
    "</details>",
  ];
}

function renderBody(pr: PR, verdict: Verdict, reasoning: string, llm: LLMVerdict | null, opinion: Opinion | null, gates: Gate[]): string {
  const icon = { APPROVED: "✅", REFUSED: "❌", ESCALATE: "🙋", ERROR: "⚠️" }[verdict];
  const parts = [`## ${icon} stamp: ${verdict}`, "", reasoning];

  if (llm?.issues.length) parts.push("", "**Issues**", ...llm.issues.map((i) => `- ${i}`));

  if (llm?.next_steps) parts.push("", `**Next:** ${llm.next_steps}`);

  if (llm?.change_summary) parts.push("", `**What changed:** ${llm.change_summary}`);

  if (verdict !== "APPROVED" && llm?.issues.length) parts.push("", ...agentPrompt(pr, verdict, reasoning, llm));
  parts.push(
    "",
    "<details><summary>mechanics</summary>",
    "",
    "| gate | result |",
    "|---|---|",
    ...gates.map((g) => `| ${g.gate} | ${g.passed ? "✓" : "✗"} ${g.message} |`),
    `| reviewer | ${BACKENDS[0]}${llm ? ` → ${llm.verdict}` : ""} |`,
    ...(opinion ? [`| second opinion | ${opinion.backend} → ${opinion.verdict} (${opinion.risk} risk) |`] : []),
    "",
    `stamp ${VERSION} · head \`${pr.headSha.slice(0, 7)}\` · base \`${pr.baseRef}@${pr.baseSha.slice(0, 7)}\` · risk ${llm?.risk ?? "n/a"}`,
    "</details>",
    runMarker(STARTED),
    reviewedMarker(pr.headSha, pr.baseSha),
  );

  return parts.join("\n").replace(/!\[([^\]]*)\]\(/g, "[image: $1]("); // no auto-fetched images: a markdown image is an exfil channel
}

/** Fetch the PR head, its base and the default branch, so both diff ends and trusted policy are local. */
function fetchRefs(pr: PR): void {
  git("fetch", "-q", "origin", `refs/pull/${pr.number}/head`, pr.baseRef, `+refs/heads/${pr.defaultBranch}:refs/remotes/origin/${pr.defaultBranch}`);
}

/** Every deterministic gate for `pr`, with policy and folder size grants read from the default branch. */
function gatesFor(pr: PR, policy: Policy, trustedRef: string) {
  const manifests = manifestsWithoutLockfile(pr.files.map((f) => f.filename));
  const sizeBudgets = resolveSizeOverrides(policy, pr.files.map((f) => f.filename), (rel) => readTrusted(repoRoot, rel, trustedRef));
  const gated = runGates(policy, { ...pr, manifestScriptEdits: manifestScriptEdits(repoRoot, pr.baseSha, pr.headSha, manifests), sizeBudgets });

  return { manifests, sizeBudgets, gated };
}

/** Slack digest of stamp-approved merges. Off until the STAMP_SLACK_WEBHOOK secret is set. */
async function runDigest(): Promise<void> {
  const webhook = process.env.STAMP_SLACK_WEBHOOK;

  if (!webhook) {
    console.log("STAMP_SLACK_WEBHOOK not set; digest is off");

    return;
  }

  const hours = Number(opts.since ?? 24);

  if (!(hours > 0)) {
    console.error("--since takes a positive number of hours");
    process.exit(2);
  }

  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const bot = process.env.STAMP_BOT_LOGIN || whoami();
  const repo = repoSlug(repoRoot);
  // Titles and summaries are PR-authored; Slack reads <...> as links and mentions (<!channel>).
  const esc = (t: string) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const items: string[] = [];

  for (const pr of mergedPRs(repoRoot)) {
    if (!pr.mergedAt || pr.mergedAt < since) continue;

    const approval = listReviews(repo, pr.number, repoRoot)
      .filter((r) => r.user.login === bot && r.state === "APPROVED")
      .at(-1);

    if (!approval) continue;
    const summary = /\*\*What changed:\*\* (.+)/.exec(approval.body)?.[1] ?? pr.title;
    items.push(`• <${pr.url}|#${pr.number} ${esc(pr.title)}> — ${esc(summary.slice(0, 200))}`);
  }

  const header = `*stamp digest* for ${repo}: ${items.length || "no"} stamp-approved merge(s) since ${since.slice(0, 16)}Z`;
  const res = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: [header, ...items].join("\n") }) });

  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`);
  console.log(`posted digest (${items.length} PRs)`);
}
