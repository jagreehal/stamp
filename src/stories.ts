// Test evidence from the repository's own CI: the executable-stories review JSON its tests wrote for the
// commit under review. Advisory only. It reaches the reviewer inside the untrusted fence, and nothing in it
// moves a gate or counts as independent assurance: the PR's author wrote the tests that produced it.
// Matching the commit makes the report relevant to this head. It does not make the report trustworthy.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

/** `stories:` in policy.yml, read from the default branch like the rest of the policy. */
export const StoriesPolicySchema = z
  .object({
    // The workflow file whose runs upload the report, e.g. ci.yml.
    workflow: z.string().min(1),
    // The artifact name that workflow uploads.
    artifact: z.string().min(1),
    // The report's path inside the artifact. unzip reads it as a pattern, so wildcards are refused.
    file: z
      .string()
      .refine((p) => !path.isAbsolute(p) && !p.split(/[\\/]/).includes("..") && !/[*?[\]\\]/.test(p), "a relative path inside the artifact, without wildcards")
      .default("index.review.json"),
    max_bytes: z.number().int().positive().max(10_000_000).default(1_000_000),
  })
  .strict();

export type StoriesPolicy = z.infer<typeof StoriesPolicySchema>;

const Strength = z.enum(["none", "weak", "moderate", "strong"]);

// The fields stamp reads from the executable-stories review report, version 1.
const ReviewReport = z.object({
  version: z.literal(1),
  // Where the tests ran, from the raw run. The report's headRef is only the comparison it was asked for.
  execution: z.object({ gitSha: z.string().optional(), runScope: z.enum(["full", "filtered"]).optional() }).optional(),
  run: z.object({ total: z.number(), passed: z.number(), failed: z.number(), skipped: z.number(), pending: z.number() }),
  findings: z.array(
    z.object({
      kind: z.enum(["failed", "unasserted", "skipped", "uncovered", "weak", "policy"]),
      severity: z.enum(["blocker", "major", "minor"]),
      title: z.string(),
      file: z.string().optional(),
      line: z.number().optional(),
      detail: z.string(),
    }),
  ),
  changedFiles: z.array(z.object({ path: z.string(), band: z.enum(["uncovered", "weak", "covered"]), claims: z.array(z.object({ scenario: z.string(), strength: Strength })) })),
});

export type ReviewReport = z.infer<typeof ReviewReport>;

export type StoryRun = { id: number; url: string; attempt: number; event: string; status: string; conclusion: string; headSha: string; createdAt: string };

export type StoryEvidence =
  | { status: "missing"; reason: string }
  | { status: "pending"; run: StoryRun }
  | { status: "invalid"; run: StoryRun; reason: string }
  | { status: "stale"; run: StoryRun; tested: string }
  | { status: "ok"; run: StoryRun; tested: "head" | "merge"; scope: "full" | "filtered" | undefined; report: ReviewReport };

export type StoryDeps = {
  /** Runs of the workflow for one commit. */
  runs: (workflow: string, sha: string) => StoryRun[];
  /** One file's text from a run's artifact, at most maxBytes; null when the run has no artifact by that name. Throws when the file cannot be read within bounds. */
  report: (runId: number, artifact: string, file: string, maxBytes: number) => string | null;
  /** A commit's parent SHAs. */
  parents: (sha: string) => string[];
};

const GhRuns = z.array(
  z.object({ databaseId: z.number(), url: z.string(), attempt: z.number(), event: z.string(), status: z.string(), conclusion: z.string(), headSha: z.string(), createdAt: z.string() }),
);

const GhArtifacts = z.object({ artifacts: z.array(z.object({ id: z.number(), name: z.string(), size_in_bytes: z.number(), expired: z.boolean() })) });

export const ARCHIVE_LIMIT = 50_000_000;

// execFileSync's error when the output passed maxBuffer.
const Overflow = z.object({ code: z.literal("ENOBUFS") });

/** One entry of a zip, read without extracting anything to disk. The entry is cut off past maxBytes, so a compressed bomb never inflates. */
export function readEntry(zip: string, file: string, maxBytes: number, timeout: number): string {
  if (!execFileSync("unzip", ["-Z1", zip], { encoding: "utf8", timeout, maxBuffer: 10_000_000 }).split("\n").includes(file)) throw new Error(`${file} is not in the artifact`);

  try {
    return execFileSync("unzip", ["-p", zip, file], { encoding: "utf8", timeout, maxBuffer: maxBytes });
  } catch (e) {
    if (Overflow.safeParse(e).success) throw new Error(`${file} is over the ${maxBytes}-byte limit`);

    throw e;
  }
}

/** StoryDeps through gh, against one repository. Each call is bounded by the caller's timeout. */
export function ghStoryDeps(repo: string, cwd: string, timeout: number): StoryDeps {
  const gh = (args: string[]) => execFileSync("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout });

  return {
    runs: (workflow, sha) =>
      GhRuns.parse(JSON.parse(gh(["run", "list", "-R", repo, "--workflow", workflow, "--commit", sha, "--limit", "20", "--json", "databaseId,url,attempt,event,status,conclusion,headSha,createdAt"]))).map(
        ({ databaseId, ...r }) => ({ id: databaseId, ...r }),
      ),
    report: (runId, artifact, file, maxBytes) => {
      const found = GhArtifacts.parse(JSON.parse(gh(["api", `repos/${repo}/actions/runs/${runId}/artifacts?name=${encodeURIComponent(artifact)}`]))).artifacts.find(
        (a) => a.name === artifact && !a.expired,
      );

      if (!found) return null;

      if (found.size_in_bytes > ARCHIVE_LIMIT) throw new Error(`the artifact is ${found.size_in_bytes} bytes zipped, over the ${ARCHIVE_LIMIT}-byte limit`);

      const dir = mkdtempSync(path.join(tmpdir(), "stamp-stories-"));

      try {
        const zip = path.join(dir, "artifact.zip");

        try {
          // GitHub's size is its own report; maxBuffer is the bound that holds.
          writeFileSync(zip, execFileSync("gh", ["api", `repos/${repo}/actions/artifacts/${found.id}/zip`], { cwd, stdio: ["ignore", "pipe", "pipe"], timeout, maxBuffer: ARCHIVE_LIMIT }));
        } catch (e) {
          if (Overflow.safeParse(e).success) throw new Error(`the artifact is over the ${ARCHIVE_LIMIT}-byte limit`);

          throw e;
        }

        return readEntry(zip, file, maxBytes, timeout);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    parents: (sha) => z.array(z.string()).parse(JSON.parse(gh(["api", `repos/${repo}/commits/${sha}`, "--jq", "[.parents[].sha]"]))),
  };
}

/** The run that tested this head: the newest attempt of the newest run whose head is exactly this commit. */
export const latestRun = (runs: StoryRun[], headSha: string) =>
  runs.filter((r) => r.headSha === headSha).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.attempt - a.attempt)[0];

/** The report's text, validated as executable-stories' review report. */
export function parseReport(text: string, file: string): { ok: true; report: ReviewReport } | { ok: false; reason: string } {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: `${file} is not JSON` };
  }

  const parsed = ReviewReport.safeParse(json);

  return parsed.success ? { ok: true, report: parsed.data } : { ok: false, reason: `${file} is not an executable-stories review report v1: ${parsed.error.issues[0]?.message ?? "invalid"}` };
}

/**
 * Which commit the report's tests ran on, from the SHA its run recorded. A pull_request workflow checks out
 * GitHub's synthetic merge of the head into the base: that counts only when its parents are exactly the
 * reviewed base and this head. Null when the report records no SHA.
 */
export function testedCommit(report: ReviewReport, headSha: string, baseSha: string, parents: StoryDeps["parents"]): "head" | "merge" | string | null {
  const tested = report.execution?.gitSha;

  if (!tested) return null;

  if (tested === headSha) return "head";

  // The report names this, so only a full SHA reaches the reviewer's trusted context.
  if (!/^[0-9a-f]{40}$/.test(tested)) return "an unrecognised ref";

  try {
    const [base, head, ...rest] = parents(tested);

    return base === baseSha && head === headSha && rest.length === 0 ? "merge" : tested;
  } catch {
    return tested;
  }
}

export function loadStoryEvidence(policy: StoriesPolicy, headSha: string, baseSha: string, deps: StoryDeps): StoryEvidence {
  let run: StoryRun | undefined;

  try {
    run = latestRun(deps.runs(policy.workflow, headSha), headSha);
  } catch (e) {
    return { status: "missing", reason: `cannot list ${policy.workflow} runs: ${e instanceof Error ? e.message.split("\n")[0] : e}` };
  }

  if (!run) return { status: "missing", reason: `no ${policy.workflow} run for ${headSha.slice(0, 7)}` };

  if (run.status !== "completed") return { status: "pending", run };

  let text: string | null;

  try {
    text = deps.report(run.id, policy.artifact, policy.file, policy.max_bytes);
  } catch (e) {
    return { status: "invalid", run, reason: `cannot read ${policy.artifact}: ${e instanceof Error ? e.message.split("\n")[0] : e}` };
  }

  if (text === null) return { status: "missing", reason: `run ${run.id} uploaded no ${policy.artifact} artifact` };

  const read = parseReport(text, policy.file);

  if (!read.ok) return { status: "invalid", run, reason: read.reason };

  const tested = testedCommit(read.report, headSha, baseSha, deps.parents);

  if (tested === null) return { status: "invalid", run, reason: `${policy.file} does not record which commit its tests ran on` };

  return tested === "head" || tested === "merge" ? { status: "ok", run, tested, scope: read.report.execution?.runScope, report: read.report } : { status: "stale", run, tested };
}

/** One line for the trusted context: what stamp found, never what the report claims. */
export function formatStoryStatus(e: StoryEvidence): string {
  const head = "Test evidence (executable-stories report from CI; advisory: it never waives a gate or counts as independent assurance, and the PR's author wrote the tests behind it):";
  const run = "run" in e ? ` run ${e.run.id} attempt ${e.run.attempt} (${e.run.event}, ${e.run.conclusion || e.run.status})` : "";

  switch (e.status) {
    case "missing":
      return `${head} missing, ${e.reason}.`;
    case "pending":
      return `${head}${run} is still running; no report yet.`;
    case "invalid":
      return `${head}${run} report unreadable: ${e.reason}.`;
    case "stale":
      return `${head}${run} tested ${e.tested.slice(0, 12)}, not this head. Read none of it as evidence for this head.`;
    case "ok":
      return `${head}${run} tested ${e.tested === "head" ? "this head" : "the merge of this head into the base"}${e.scope === "filtered" ? " in a filtered run, so it covers only the scenarios that ran" : ""}. The report follows inside the untrusted content.`;
  }
}

/** The report's findings and coverage bands, for inside the untrusted fence. `clip` makes each field one bounded line. */
export function formatStoryReport(r: ReviewReport, clip: (s: string, n: number) => string): string[] {
  const bands = (band: string) => r.changedFiles.filter((f) => f.band === band).map((f) => clip(f.path, 200));

  return [
    `Test evidence report: ${r.run.total} scenarios, ${r.run.passed} passed, ${r.run.failed} failed, ${r.run.skipped} skipped, ${r.run.pending} pending.`,
    ...r.findings.slice(0, 40).map((f) => `  [${f.severity}] ${f.kind}: ${clip(f.title, 200)}${f.file ? ` (${clip(f.file, 200)}${f.line ? `:${f.line}` : ""})` : ""}: ${clip(f.detail, 500)}`),
    ...(bands("uncovered").length ? [`  Changed files no scenario covers: ${bands("uncovered").slice(0, 40).join(", ")}`] : []),
    ...(bands("weak").length ? [`  Changed files only weak scenarios cover: ${bands("weak").slice(0, 40).join(", ")}`] : []),
  ];
}

/** The evidence bundle's record: the status and the run, with counts in place of the report's text. */
export function storyEvidenceRecord(e: StoryEvidence | null) {
  if (!e) return null;

  if (e.status === "missing") return { status: e.status, reason: e.reason };

  const run = { id: e.run.id, url: e.run.url, attempt: e.run.attempt, event: e.run.event, conclusion: e.run.conclusion };

  switch (e.status) {
    case "pending":
      return { status: e.status, run };
    case "invalid":
      return { status: e.status, run, reason: e.reason };
    case "stale":
      return { status: e.status, run, tested: e.tested };
    case "ok":
      return { status: e.status, run, tested: e.tested, scope: e.scope ?? null, run_counts: e.report.run, findings: e.report.findings.length, uncovered: e.report.changedFiles.filter((f) => f.band === "uncovered").length };
  }
}
