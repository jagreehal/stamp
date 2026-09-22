// Policy loading + deterministic gates. No LLM here: everything in this file is
// reproducible from the file list, the diff stats, and .stamp/policy.yml.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const Match = z.object({
  any: z.array(z.string()).default([]),
  titles: z.array(z.string()).default([]),
  paths: z.array(z.string()).default([]),
});

export const PolicySchema = z
  .object({
    version: z.literal(1),
    deny: z.record(z.string(), z.object({ description: z.string().optional(), match: Match })),
    allow: z.object({ path_patterns: z.array(z.string()), extensions_only: z.array(z.string()) }),
    size_gate: z.object({ max_lines: z.number().int().positive(), max_files: z.number().int().positive() }),
    tiers: z.record(z.string(), z.object({ max_lines: z.number().int(), max_files: z.number().int() })),
    scrutiny: z.record(z.string(), z.object({ description: z.string().optional(), paths: z.array(z.string()), instruction: z.string() })).default({}),
    reviewer_bots: z.array(z.string()).default([]),
  })
  .strict()
  .refine((p) => "stamp_policy" in p.deny, { message: "deny.stamp_policy is required: the gate cannot approve edits to itself" });

export type Policy = z.infer<typeof PolicySchema>;

/** The package's own .stamp/: the hosted default a repo with no policy files reviews under. */
export const DEFAULTS_DIR = path.resolve(import.meta.dir, "..");

/**
 * Read a policy file from the trusted ref (the default branch), else the package's bundled
 * default. The working tree is NEVER consulted: it is the PR head, and a PR must not be able to
 * supply the policy that gates it. A repo with no .stamp/ on its default branch reviews under
 * the bundled defaults, however many .stamp/ files the PR adds.
 */
export function readTrusted(repoRoot: string, rel: string, ref = "origin/HEAD"): string | null {
  const git = (args: string[]) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let refExists = false;

  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    refExists = true;
  } catch {
    /* no such ref: local run with no remote */
  }

  if (refExists) {
    try {
      return git(["show", `${ref}:${rel}`]);
    } catch {
      /* ref exists, file absent on it: bundled default below */
    }
  }

  try {
    return readFileSync(path.join(DEFAULTS_DIR, rel), "utf8");
  } catch {
    return null;
  }
}

export function loadPolicy(repoRoot: string, ref?: string): Policy {
  const raw = readTrusted(repoRoot, ".stamp/policy.yml", ref);

  if (raw === null) throw new Error("missing .stamp/policy.yml");

  return PolicySchema.parse(parseYaml(raw));
}

export function loadGuidance(repoRoot: string, ref?: string): string {
  const raw = readTrusted(repoRoot, ".stamp/review-guidance.md", ref);

  if (raw === null) throw new Error("missing .stamp/review-guidance.md");
  // Optional repo-specific appendix, so a repo can add norms without replacing the whole file.
  const steering = readTrusted(repoRoot, ".stamp/steering.md", ref);

  return steering ? `${raw}\n\n# Repository-specific steering\n\n${steering}` : raw;
}

// ── Classification ────────────────────────────────────────────────────────────

export type PRFile = { filename: string; previousFilename?: string; additions: number; deletions: number; status?: string };

// Path fragments (contain "/" or start with a dot) match literally. Words get boundaries that also
// break on _ and -, so "secret" hits "secret_key.ts" but not "nosecrets.ts", and "auth" not "author".
const wb = (p: string) =>
  p.includes("/") || p.startsWith("\\.") ? new RegExp(p, "i") : new RegExp(`(?<![a-z0-9])(?:${p})(?![a-z0-9])`, "i");

const TEST_RE = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(py|go|rs)$|(^|\/)test_[^/]+\.py$|(^|\/)conftest\.py$/i;

const SIZE_EXEMPT_RE = /\.(md|mdx|txt|rst|snap|ambr|lock|png|jpe?g|gif|svg|webp|ico)$|(^|\/)__snapshots__\//i;

const MANIFEST_RE = /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|Gemfile|tsconfig[^/]*\.json)$/i;

const LOCKFILE_RE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lock|uv\.lock|poetry\.lock|Cargo\.lock|go\.sum|Gemfile\.lock)$/i;

export const isTest = (p: string) => TEST_RE.test(p);

export const isSizeExempt = (p: string) => isTest(p) || SIZE_EXEMPT_RE.test(p);

export function denyCategories(policy: Policy, files: string[]): string[] {
  const hit: string[] = [];

  for (const [cat, rule] of Object.entries(policy.deny)) {
    const res = [...rule.match.paths, ...rule.match.any].map(wb);

    if (files.some((f) => res.some((r) => r.test(f)))) hit.push(cat);
  }

  return hit;
}

export function titleFlags(policy: Policy, title: string, denied: string[]): string[] {
  const hit: string[] = [];

  for (const [cat, rule] of Object.entries(policy.deny)) {
    if (denied.includes(cat)) continue;
    const res = [...rule.match.any, ...rule.match.titles].map(wb);

    if (res.some((r) => r.test(title))) hit.push(cat);
  }

  return hit;
}

export type ScrutinyFlag = { name: string; files: string[]; instruction: string };

/** Paths that never deny but must be named to the reviewer with what would make them a refusal. */
export function scrutinyFlags(policy: Policy, files: string[]): ScrutinyFlag[] {
  const out: ScrutinyFlag[] = [];

  for (const [name, rule] of Object.entries(policy.scrutiny)) {
    const res = rule.paths.map(wb);
    const hit = files.filter((f) => res.some((r) => r.test(f)));

    if (hit.length) out.push({ name, files: hit, instruction: rule.instruction });
  }

  return out;
}

export function manifestsWithoutLockfile(files: string[]): string[] {
  if (files.some((f) => LOCKFILE_RE.test(f))) return [];

  return files.filter((f) => MANIFEST_RE.test(f));
}

// Deterministic first line for manifests: scripts and lifecycle hooks execute in CI and on dev
// machines even when no lockfile changes. package.json is compared structurally between base and
// head (editing an existing script's command never mentions "scripts" on the changed line, so a
// line scan would miss it); other manifests fall back to a line scan. Parse failure fails closed.
const PKG_RISKY_KEYS = ["scripts", "husky", "lint-staged", "pnpm", "simple-git-hooks"];

const RISKY_LINE_RE = /^[+-]\s*(\[?(tool\.)?scripts|entry[-_]points|build\s*=|replace\s|"?(pre|post)?(install|prepare|publish|pack)"?\s*[:=])/;

export function manifestScriptEdits(repoRoot: string, baseSha: string, headSha: string, manifests: string[]): string[] {
  const show = (ref: string, file: string) => {
    try {
      return execFileSync("git", ["-C", repoRoot, "show", `${ref}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return ""; // absent on that side (added/deleted file)
    }
  };

  const risky: string[] = [];

  for (const file of manifests) {
    const base = show(baseSha, file);
    const head = show(headSha, file);

    if (path.basename(file) === "package.json") {
      const pick = (t: string) => {
        const o = t.trim() ? JSON.parse(t) : {};

        return JSON.stringify(Object.fromEntries(PKG_RISKY_KEYS.map((k) => [k, o[k]])));
      };

      try {
        if (pick(base) !== pick(head)) risky.push(file);
      } catch {
        risky.push(file); // unparseable: fail closed
      }

      continue;
    }

    let diff = "";

    try {
      diff = execFileSync("git", ["-C", repoRoot, "diff", baseSha, headSha, "--", file], { encoding: "utf8" });
    } catch {
      risky.push(file);
      continue;
    }

    if (diff.split("\n").some((l) => RISKY_LINE_RE.test(l))) risky.push(file);
  }

  return risky;
}

export function isAllowListedOnly(policy: Policy, files: string[]): boolean {
  if (files.length === 0) return false;
  const exts = new Set(policy.allow.extensions_only.map((e) => e.toLowerCase()));

  return files.every(
    (f) =>
      isTest(f) ||
      policy.allow.path_patterns.some((p) => f.includes(p)) ||
      exts.has(path.extname(f).toLowerCase()),
  );
}

export type Size = { lines: number; files: number };

export function substantiveSize(files: PRFile[]): Size {
  const s = files.filter((f) => !isSizeExempt(f.filename));

  return { lines: s.reduce((n, f) => n + f.additions + f.deletions, 0), files: s.length };
}

export type Tier = { tier: string; sub?: string };

export function tier(policy: Policy, files: PRFile[], denied: string[]): Tier {
  if (denied.length) return { tier: "T2-never" };
  const names = files.map((f) => f.filename);

  if (isAllowListedOnly(policy, names) && manifestsWithoutLockfile(names).length === 0) return { tier: "T0-deterministic" };
  const { lines, files: n } = substantiveSize(files);

  for (const [name, t] of Object.entries(policy.tiers)) {
    if (lines <= t.max_lines && n <= t.max_files) return { tier: "T1-agent", sub: name };
  }

  return { tier: "T1-agent", sub: "T1d-complex" };
}

// ── Ownership (CODEOWNERS, advisory) ─────────────────────────────────────────
//
// Who owns the changed files, so an ESCALATE names a person and an author who owns what they
// touched can count as assurance. Read from the trusted ref: ownership is a gate input. Last
// matching pattern wins, as GitHub resolves it.

export type Ownership = { owners: Map<string, string[]>; unowned: string[]; authorOwns: boolean | null };

const codeownersGlob = (p: string): RegExp => {
  const anchored = p.startsWith("/");
  let g = p.replace(/^\//, "");
  const dirOnly = g.endsWith("/");
  g = g.replace(/\/$/, "");

  // Tokenize rather than chain replaces: a later replace would otherwise rewrite the `?` and `.`
  // inside regex syntax an earlier one emitted.
  let re = "";

  for (let i = 0; i < g.length; i++) {
    if (g.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 2;
    } else if (g.startsWith("**", i)) {
      re += ".*";
      i += 1;
    } else if (g[i] === "*") re += "[^/]*";
    else if (g[i] === "?") re += "[^/]";
    else re += g[i]!.replace(/[.+^${}()|[\]\\]/, "\\$&");
  }

  const prefix = anchored || g.includes("/") ? "^" : "(?:^|/)";

  return new RegExp(`${prefix}${re}${dirOnly || !g.includes(".") ? "(?:/|$)" : "$"}`);
};

export function parseCodeowners(text: string): { re: RegExp; owners: string[] }[] {
  return text
    .split("\n")
    .map((l) => l.replace(/(^|\s)#.*$/, "").trim())
    .filter(Boolean)
    .map((l) => {
      const [pattern, ...owners] = l.split(/\s+/);

      return { re: codeownersGlob(pattern!), owners };
    });
}

export function detectOwnership(rules: { re: RegExp; owners: string[] }[], files: string[], author: string): Ownership {
  const owners = new Map<string, string[]>();
  const unowned: string[] = [];

  for (const f of files) {
    const hit = [...rules].reverse().find((r) => r.re.test(f));

    if (hit?.owners.length) owners.set(f, hit.owners);
    else unowned.push(f);
  }

  const all = [...new Set([...owners.values()].flat())];
  // Individuals are checked directly; team handles (@org/team) can't be resolved without an org read.
  const authorOwns = all.length === 0 ? null : all.some((o) => o.toLowerCase() === `@${author.toLowerCase()}`) ? true : all.every((o) => o.includes("/")) ? null : false;

  return { owners, unowned, authorOwns };
}

export type Gate = { gate: string; passed: boolean; message: string };

export type PRMeta = {
  title: string;
  author: string;
  authorAssociation: string;
  isFork: boolean;
  isDraft: boolean;
  mergeable: string;
  reviews: { user: string; state: string }[];
  files: PRFile[];
  manifestScriptEdits?: string[];
};

const BOT_RE = /\[bot\]$|^(dependabot|renovate)/i;

// Only people who could merge anyway. A drive-by contributor's PR is never auto-approved.
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export type GateRun = Tier & { gates: Gate[]; denied: string[] };

export function runGates(policy: Policy, pr: PRMeta): GateRun {
  // Both ends of a rename count: moving a file out of auth/ is a change to auth/.
  const names = pr.files.flatMap((f) => (f.previousFilename ? [f.filename, f.previousFilename] : [f.filename]));
  const gates: Gate[] = [];

  // A CHANGES_REQUESTED stays blocking until that user APPROVES or it is DISMISSED; a later COMMENTED
  // review does not withdraw it. Track each user's latest *decision*, skipping comments.
  const latest = new Map<string, string>();

  for (const r of pr.reviews) if (r.state !== "COMMENTED" && r.state !== "PENDING") latest.set(r.user, r.state);
  const blocking = [...latest].flatMap(([u, s]) => (s === "CHANGES_REQUESTED" ? [u] : []));

  const prereqProblems = [
    pr.isDraft ? "draft" : null,
    pr.mergeable === "CONFLICTING" ? "merge conflicts" : null,
    blocking.length ? `changes requested by ${blocking.join(", ")}` : null,
    BOT_RE.test(pr.author) ? `bot author ${pr.author}` : null,
    pr.isFork ? "head is on a fork" : null,
    TRUSTED_ASSOCIATIONS.has(pr.authorAssociation) ? null : `author is ${pr.authorAssociation}, not a collaborator`,
  ].filter(Boolean);

  gates.push({ gate: "prerequisites", passed: prereqProblems.length === 0, message: prereqProblems.join("; ") || "ready" });

  const denied = denyCategories(policy, names);
  const scripts = pr.manifestScriptEdits ?? [];
  gates.push({
    gate: "deny-list",
    passed: denied.length === 0 && scripts.length === 0,
    message: [denied.length ? `touches ${denied.join(", ")}` : "", scripts.length ? `scripts/hooks changed in ${scripts.join(", ")}` : ""].filter(Boolean).join("; ") || "no sensitive paths",
  });

  const size = substantiveSize(pr.files);
  const tooBig = size.lines > policy.size_gate.max_lines || size.files > policy.size_gate.max_files;
  gates.push({
    gate: "size",
    passed: !tooBig,
    message: `${size.lines} substantive lines / ${size.files} files (limit ${policy.size_gate.max_lines}/${policy.size_gate.max_files})`,
  });

  const t = tier(policy, pr.files, denied);
  gates.push({ gate: "tier", passed: t.tier !== "T2-never", message: [t.tier, t.sub].filter(Boolean).join(" / ") });

  return { gates, denied, ...t };
}
