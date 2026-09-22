// Author-familiarity signal for the reviewer (judgment layer only).
//
// Blame overlap + prior merged PRs in the changed paths → STRONG / MODERATE / NONE.
// Never a gate; failures yield null (signal absent). NONE omits negative facts
// from the prompt (one-way ratchet).
//
// Every history query is anchored to the default branch (`trustedRef`), never to
// the checkout: the checkout is the PR head, and a PR's own commit subjects could
// otherwise claim the author's merged PR numbers and manufacture familiarity.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { z } from "zod";

/** Author names are untrusted display hints; strip controls and cap length. */
const scrubName = (s: string, max: number) => s.replace(/[^\P{C}\n\t]/gu, "").slice(0, max);

export const FamiliarityPolicySchema = z
  .object({
    strong: z.object({ min_blame_overlap_pct: z.number().min(0).max(100) }),
    moderate: z.object({
      min_prior_prs: z.number().int().positive(),
      max_days_since_touch: z.number().int().positive(),
    }),
  })
  .strict();

export type FamiliarityPolicy = z.infer<typeof FamiliarityPolicySchema>;

export type AuthorFamiliarity = {
  band: "STRONG" | "MODERATE" | "NONE";
  blame_overlap_pct: number;
  modified_lines_owned: number;
  modified_lines_total: number;
  prior_prs_in_paths: number;
  days_since_last_touch: number | null;
  files_prev_count: number;
  files_total: number;
  capped: boolean;
  blame_incomplete_files: number;
  top_prior_authors: string[];
};

export const familiarityEvidence = (fam: AuthorFamiliarity | null) => fam && { ...fam, blame_overlap_pct: Math.round(fam.blame_overlap_pct * 10) / 10 };

const TIMEOUT_MS = 30_000;

const UNSHALLOW_TIMEOUT_MS = 5 * 60_000;

const MAX_CHANGED_LINES_PER_FILE = 2000;

const MAX_BLAME_FILES = 30;

const LOG_SINCE = "18.months";

const TWELVE_MONTHS_DAYS = 365;

const TOP_PRIOR_AUTHORS = 2;

const SQUASH_PR_RE = /\(#(\d+)\)/g;

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const AuthorPrList = z.array(z.object({ number: z.number() }));

type FileDiff = {
  old_path: string | null;
  new_path: string | null;
  base_modified_lines: number[];
  changed_lines: number;
  is_binary: boolean;
};

type BlameOverlap = { owned: number; total: number; incomplete: number; topPriorAuthors: string[] };

const path_of = (f: FileDiff) => f.new_path || f.old_path || "";

function git(repoRoot: string, args: string[], timeout = TIMEOUT_MS): string | null {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      timeout,
      maxBuffer: 16 << 20,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function fetchAuthorPrNumbers(authorLogin: string, repo: string): Set<number> | null {
  try {
    const out = execFileSync(
      "gh",
      ["pr", "list", "--repo", repo, "--author", authorLogin, "--state", "merged", "--limit", "1000", "--json", "number"],
      { encoding: "utf8", timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] },
    );

    const parsed = AuthorPrList.safeParse(JSON.parse(out));

    if (!parsed.success) return null;

    return new Set(parsed.data.map((item) => item.number));
  } catch {
    return null;
  }
}

function extractPrNumber(subject: string): number | null {
  let last: number | null = null;

  for (const m of subject.matchAll(SQUASH_PR_RE)) last = Number(m[1]);

  return last;
}

function stripDiffPath(raw: string): string | null {
  const t = raw.trim();

  if (t === "/dev/null") return null;

  if (t.startsWith("a/") || t.startsWith("b/")) return t.slice(2);

  return t;
}

/** Parse a unified diff into per-file base-side modified line numbers (deleted/replaced lines). */
export function parseDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let seenHunk = false;
  let oldLine = 0;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git")) {
      if (current) files.push(current);
      current = { old_path: null, new_path: null, base_modified_lines: [], changed_lines: 0, is_binary: false };
      seenHunk = false;
      oldLine = 0;
      continue;
    }

    if (!current) continue;

    if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) {
      current.is_binary = true;
      continue;
    }

    if (!seenHunk && line.startsWith("--- ")) {
      current.old_path = stripDiffPath(line.slice(4));
      continue;
    }

    if (!seenHunk && line.startsWith("+++ ")) {
      current.new_path = stripDiffPath(line.slice(4));
      continue;
    }

    const hunk = HUNK_RE.exec(line);

    if (hunk) {
      seenHunk = true;
      oldLine = Number(hunk[1]);
      continue;
    }

    if (!seenHunk || !line) continue;
    const tag = line[0];

    if (tag === "-") {
      current.base_modified_lines.push(oldLine);
      current.changed_lines += 1;
      oldLine += 1;
    } else if (tag === "+") {
      current.changed_lines += 1;
    } else if (tag === " ") {
      oldLine += 1;
    }
  }

  if (current) files.push(current);

  return files;
}

function coalesce(lines: number[]): [number, number][] {
  const ranges: [number, number][] = [];

  for (const n of [...new Set(lines)].sort((a, b) => a - b)) {
    const last = ranges.at(-1);

    if (last && n === last[1] + 1) last[1] = n;
    else ranges.push([n, n]);
  }

  return ranges;
}

function selectConsidered(fileDiffs: FileDiff[]) {
  const eligible = fileDiffs.filter((f) => !f.is_binary && f.changed_lines <= MAX_CHANGED_LINES_PER_FILE);
  const oversize = fileDiffs.some((f) => !f.is_binary && f.changed_lines > MAX_CHANGED_LINES_PER_FILE);
  eligible.sort((a, b) => b.changed_lines - a.changed_lines);

  return { considered: eligible.slice(0, MAX_BLAME_FILES), capped: oversize || eligible.length > MAX_BLAME_FILES };
}

const BLAME_HEADER_RE = /^([0-9a-f]{40,64}) \d+ \d+/;

type BlameLine = { commit: string | null; author: string | null; summary: string | null };

function parseBlamePorcelain(text: string): BlameLine[] {
  const entries: BlameLine[] = [];
  let commit: string | null = null;
  let author: string | null = null;
  let summary: string | null = null;

  for (const line of text.split("\n")) {
    const header = BLAME_HEADER_RE.exec(line);

    if (header) commit = header[1] ?? null;
    else if (line.startsWith("author ")) author = line.slice("author ".length);
    else if (line.startsWith("summary ")) summary = line.slice("summary ".length);
    else if (line.startsWith("\t")) {
      entries.push({ commit, author, summary });
      commit = null;
      author = null;
      summary = null;
    }
  }

  return entries;
}

/** `unmerged` commits never earn credit: their subjects, and so their `(#N)`, are PR-authored. */
function blameOverlap(considered: FileDiff[], blameSha: string, unmerged: Set<string>, authorPrs: Set<number>, repoRoot: string): BlameOverlap {
  let owned = 0;
  let total = 0;
  let incomplete = 0;
  const counts = new Map<string, number>();

  for (const fileDiff of considered) {
    const blamePath = fileDiff.old_path;

    if (!blamePath) continue;
    const ranges = coalesce(fileDiff.base_modified_lines);

    if (!ranges.length) continue;
    const rangeFlags = ranges.flatMap(([start, end]) => ["-L", `${start},${end}`]);
    const out = git(repoRoot, ["blame", blameSha, ...rangeFlags, "--line-porcelain", "--", blamePath]);

    if (out === null) {
      total += ranges.reduce((n, [s, e]) => n + (e - s + 1), 0);
      incomplete += 1;
      continue;
    }

    for (const { commit, author, summary } of parseBlamePorcelain(out)) {
      total += 1;

      if (!commit || unmerged.has(commit)) continue;
      const prNumber = extractPrNumber(summary || "");

      if (prNumber !== null && authorPrs.has(prNumber)) owned += 1;
      else if (author) counts.set(author, (counts.get(author) ?? 0) + 1);
    }
  }

  const topPriorAuthors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_PRIOR_AUTHORS)
    .map(([name]) => name);

  return { owned, total, incomplete, topPriorAuthors };
}

/** Each path's parent directory; a top-level file stands for itself rather than the whole repo. */
const pathSpecs = (paths: string[]) => [...new Set(paths.map((p) => (p.includes("/") ? path.posix.dirname(p) : p)))].sort();

function priorPrsInPaths(paths: string[], authorPrs: Set<number>, repoRoot: string, trustedRef: string, now: number) {
  const specs = pathSpecs(paths);

  if (!specs.length) return { prior: 0, daysSince: null };
  const out = git(repoRoot, ["log", trustedRef, `--since=${LOG_SINCE}`, "--format=%ct%x09%s", "--", ...specs]);

  if (out === null) return { prior: 0, daysSince: null };
  const cutoff = now / 1000 - TWELVE_MONTHS_DAYS * 86400;
  const recent = new Set<number>();
  let lastTouch: number | null = null;

  for (const line of out.split("\n")) {
    const tab = line.indexOf("\t");

    if (tab < 0) continue;
    const commitTime = Number(line.slice(0, tab));

    if (!Number.isFinite(commitTime)) continue;
    const prNumber = extractPrNumber(line.slice(tab + 1));

    if (prNumber === null || !authorPrs.has(prNumber)) continue;

    if (lastTouch === null || commitTime > lastTouch) lastTouch = commitTime;

    if (commitTime >= cutoff) recent.add(prNumber);
  }

  const daysSince = lastTouch !== null ? Math.floor((now / 1000 - lastTouch) / 86400) : null;

  return { prior: recent.size, daysSince };
}

/** How many considered files the author's merged PRs touched. */
function filesPreviouslyModified(considered: FileDiff[], authorPrs: Set<number>, repoRoot: string, trustedRef: string): number {
  const allPaths = [...new Set(considered.flatMap((f) => [f.old_path, f.new_path].filter((p): p is string => !!p)))].sort();

  if (!allPaths.length) return 0;
  const out = git(repoRoot, ["log", trustedRef, `--since=${LOG_SINCE}`, "--format=%x01%s", "--name-only", "--no-renames", "--", ...allPaths]);

  if (out === null) return 0;
  const wanted = new Set(allPaths);
  const touched = new Set<string>();
  let currentIsAuthors = false;

  for (const line of out.split("\n")) {
    if (line.startsWith("\x01")) {
      const prNumber = extractPrNumber(line.slice(1));
      currentIsAuthors = prNumber !== null && authorPrs.has(prNumber);
    } else if (line && currentIsAuthors && wanted.has(line)) {
      touched.add(line);
    }
  }

  return considered.filter((f) => (f.old_path && touched.has(f.old_path)) || (f.new_path && touched.has(f.new_path))).length;
}

/** STRONG / MODERATE / NONE from policy thresholds. */
export function band(
  blameOverlapPct: number,
  priorPrsInPathsCount: number,
  daysSinceLastTouch: number | null,
  thresholds: FamiliarityPolicy,
): AuthorFamiliarity["band"] {
  if (blameOverlapPct >= thresholds.strong.min_blame_overlap_pct) return "STRONG";

  if (
    priorPrsInPathsCount >= thresholds.moderate.min_prior_prs &&
    daysSinceLastTouch !== null &&
    daysSinceLastTouch <= thresholds.moderate.max_days_since_touch
  ) {
    return "MODERATE";
  }

  return "NONE";
}

const isShallow = (repoRoot: string) => git(repoRoot, ["rev-parse", "--is-shallow-repository"])?.trim() !== "false";

/**
 * Blame and log need real history. CI checks out at depth 1, where the merge-base is missing and
 * blame would pin every older line on the boundary commit. Deepen once, on demand, so runs that never
 * reach familiarity pay nothing. False when the repo is still shallow; the signal is then skipped.
 */
export function ensureFullHistory(repoRoot: string): boolean {
  if (isShallow(repoRoot)) git(repoRoot, ["fetch", "-q", "--unshallow", "origin"], UNSHALLOW_TIMEOUT_MS);

  return !isShallow(repoRoot);
}

/**
 * Compute author familiarity with the code the PR modifies.
 * Returns null when the gh call failed or history is shallow (signal absent); other
 * degradations yield a result.
 */
export function computeFamiliarity(opts: {
  authorLogin: string;
  diff: string;
  baseSha: string;
  headSha: string;
  repo: string;
  repoRoot: string;
  /** The default branch: only history merged there counts. */
  trustedRef: string;
  thresholds: FamiliarityPolicy;
  now?: number;
}, deps = { fetchAuthorPrNumbers }): AuthorFamiliarity | null {
  const authorPrs = deps.fetchAuthorPrNumbers(opts.authorLogin, opts.repo);

  if (authorPrs === null || isShallow(opts.repoRoot)) return null;
  const now = opts.now ?? Date.now();
  const { considered, capped } = selectConsidered(parseDiff(opts.diff));
  const consideredPaths = considered.map(path_of).filter(Boolean);
  const blameSha = git(opts.repoRoot, ["merge-base", opts.baseSha, opts.headSha])?.trim() || null;
  // Blame runs where the diff's line numbers live, the merge-base. On a stacked PR that sits on an
  // unmerged branch, so commits not yet on the default branch are listed and never credited.
  const unmergedLog = blameSha ? git(opts.repoRoot, ["rev-list", blameSha, `^${opts.trustedRef}`]) : null;
  const unmerged = unmergedLog === null ? null : new Set(unmergedLog.split("\n").filter(Boolean));
  const emptyOverlap: BlameOverlap = { owned: 0, total: 0, incomplete: 0, topPriorAuthors: [] };
  const overlap = blameSha && unmerged ? blameOverlap(considered, blameSha, unmerged, authorPrs, opts.repoRoot) : emptyOverlap;
  const blameOverlapPct = overlap.total ? (100 * overlap.owned) / overlap.total : 0;
  const { prior, daysSince } = priorPrsInPaths(consideredPaths, authorPrs, opts.repoRoot, opts.trustedRef, now);

  return {
    band: band(blameOverlapPct, prior, daysSince, opts.thresholds),
    blame_overlap_pct: blameOverlapPct,
    modified_lines_owned: overlap.owned,
    modified_lines_total: overlap.total,
    prior_prs_in_paths: prior,
    days_since_last_touch: daysSince,
    files_prev_count: filesPreviouslyModified(considered, authorPrs, opts.repoRoot, opts.trustedRef),
    files_total: considered.length,
    capped,
    blame_incomplete_files: overlap.incomplete,
    top_prior_authors: overlap.topPriorAuthors,
  };
}

/**
 * TRUSTED prompt block, or "" when absent / NONE without reviewer hints, which leaves the
 * prompt unchanged (ratchet).
 */
export function formatFamiliarity(fam: AuthorFamiliarity | null | undefined): string {
  if (!fam) return "";

  const reviewers = fam.top_prior_authors.length
    ? `\nMost familiar with the modified lines (suggested reviewers if you escalate): ${fam.top_prior_authors.map((n) => scrubName(n, 80)).join(", ")}.`
    : "";

  if (fam.band === "NONE") return reviewers;

  const parts = [
    `band ${fam.band}`,
    `author last-touched ${fam.blame_overlap_pct.toFixed(0)}% of the lines this diff modifies`,
    `${fam.files_prev_count}/${fam.files_total} changed files previously modified`,
    `${fam.prior_prs_in_paths} merged PRs in these paths in 12 months`,
    fam.days_since_last_touch !== null ? `last touch ${fam.days_since_last_touch} days ago` : "no prior touch found in the last 18 months",
  ];

  const capped = fam.capped ? " (Metrics computed on a bounded subset of the changed files.)" : "";

  return `\nAuthor familiarity with the changed code (computed from default-branch git history): ${parts.join("; ")}.${capped}${reviewers}`;
}
