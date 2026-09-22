// Policy loading + deterministic gates. No LLM here: everything in this file is
// reproducible from the file list, the diff stats, and .stamp/policy.yml.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { FamiliarityPolicySchema } from "./familiarity.ts";

const Match = z.object({
  any: z.array(z.string()).default([]),
  titles: z.array(z.string()).default([]),
  paths: z.array(z.string()).default([]),
});

const OverrideCeiling = z.object({ ceiling: z.number().int().positive() });

export const PolicySchema = z
  .object({
    version: z.literal(1),
    deny: z.record(z.string(), z.object({ description: z.string().optional(), match: Match })),
    allow: z.object({ path_patterns: z.array(z.string()), extensions_only: z.array(z.string()) }),
    size_gate: z.object({ max_lines: z.number().int().positive(), max_files: z.number().int().positive() }),
    tiers: z.record(z.string(), z.object({ max_lines: z.number().int(), max_files: z.number().int() })),
    // Contract ceilings for AGENT_APPROVALS.md grants. Absent = no folder delegation.
    overrides: z
      .object({
        "size_gate.max_lines": OverrideCeiling,
        "size_gate.max_files": OverrideCeiling,
      })
      .strict()
      .optional(),
    // Judgment-layer only; never a gate. Absent = no familiarity signal computed.
    familiarity: FamiliarityPolicySchema.optional(),
    scrutiny: z.record(z.string(), z.object({ description: z.string().optional(), paths: z.array(z.string()), instruction: z.string() })).default({}),
    reviewer_bots: z.array(z.string()).default([]),
  })
  .strict()
  .refine((p) => "stamp_policy" in p.deny, { message: "deny.stamp_policy is required: the gate cannot approve edits to itself" })
  .refine((p) => !p.overrides || (p.overrides["size_gate.max_lines"].ceiling >= p.size_gate.max_lines && p.overrides["size_gate.max_files"].ceiling >= p.size_gate.max_files), {
    message: "overrides ceilings must cover the global size_gate limits",
  });

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

/**
 * Reviewer bots that are still working: a 👀 from a bot on the policy's list, young enough to be a
 * live review rather than a crashed one. Logins come from the REST API, so they carry the `[bot]`
 * suffix the policy list is written with.
 */
export function inFlightBots(reactions: { user: string; content: string; created: string }[], bots: string[], staleMs: number, now = Date.now()): string[] {
  return reactions.flatMap((r) => (r.content === "eyes" && bots.includes(r.user) && now - Date.parse(r.created) < staleMs ? [r.user] : []));
}

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

// ── Per-folder size overrides (AGENT_APPROVALS.md, trusted ref only) ─────────
//
// Size grants are gate inputs, so they are read from the default branch via
// readTrusted — never from the PR head. Frontmatter under `stamp:` may raise
// max_files / max_lines within the policy's overrides ceilings. Invalid
// frontmatter = no grant from that file.

const FOLDER_POLICY_FILENAME = "AGENT_APPROVALS.md";

export type ScopeBudget = { path: string | null; ceiling: number; files: string[] };

export type EffectiveSize = { file_scopes: ScopeBudget[]; line_scopes: ScopeBudget[]; invalid_folder_files: string[] };

type SizeKey = "max_files" | "max_lines";

type FolderGrant = { [K in SizeKey]?: number } & { invalid?: true };

const INVALID: FolderGrant = { invalid: true };

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

const FolderFrontmatter = z
  .object({
    stamp: z
      .object({ size_gate: z.object({ max_files: z.number().int().positive().optional(), max_lines: z.number().int().positive().optional() }).strict() })
      .strict()
      .optional(),
  })
  .passthrough();

function parseFolderGrant(text: string, contract: NonNullable<Policy["overrides"]>): FolderGrant {
  const yaml = FRONTMATTER_RE.exec(text)?.[1];

  if (yaml === undefined) return INVALID;
  let front: unknown;

  try {
    front = parseYaml(yaml);
  } catch {
    return INVALID;
  }

  const parsed = FolderFrontmatter.safeParse(front);

  if (!parsed.success) return INVALID;
  const grant = parsed.data.stamp?.size_gate;

  if (!grant) return {}; // prose-only / advisory

  if (grant.max_files === undefined && grant.max_lines === undefined) return INVALID;

  if ((grant.max_files ?? 0) > contract["size_gate.max_files"].ceiling || (grant.max_lines ?? 0) > contract["size_gate.max_lines"].ceiling) return INVALID;

  return grant;
}

/** Directories at or above the file, nearest first; "" is the repo root. */
function scopeChain(filePath: string): string[] {
  const dirs: string[] = [];

  for (let dir = path.posix.dirname(filePath); dir !== "." && dir !== "/"; dir = path.posix.dirname(dir)) dirs.push(dir);

  return [...dirs, ""];
}

/** Buckets each file under its nearest grant for `key`; files with none share the global pool, listed last. */
function nearestScopes(changedFiles: string[], key: SizeKey, globalCeiling: number, grantAt: (rel: string) => FolderGrant): ScopeBudget[] {
  const folders = new Map<string, ScopeBudget>();
  const pool: ScopeBudget = { path: null, ceiling: globalCeiling, files: [] };

  for (const file of changedFiles) {
    let scope = pool;

    for (const dir of scopeChain(file)) {
      const rel = dir ? `${dir}/${FOLDER_POLICY_FILENAME}` : FOLDER_POLICY_FILENAME;
      const ceiling = grantAt(rel)[key];

      if (ceiling === undefined) continue;
      scope = folders.get(rel) ?? { path: rel, ceiling, files: [] };
      folders.set(rel, scope);
      break;
    }

    scope.files.push(file);
  }

  return [...folders.values(), pool];
}

/**
 * Resolve per-scope size budgets from AGENT_APPROVALS.md files on the trusted ref.
 * When policy.overrides is absent, nothing is read and every file shares the global pool.
 */
export function resolveSizeOverrides(policy: Policy, changedFiles: string[], readFile: (rel: string) => string | null): EffectiveSize {
  const contract = policy.overrides;
  const cache = new Map<string, FolderGrant>();

  const grantAt = (rel: string): FolderGrant => {
    if (!contract) return {};
    let grant = cache.get(rel);

    if (!grant) {
      const text = readFile(rel);
      grant = text === null ? {} : parseFolderGrant(text, contract);
      cache.set(rel, grant);
    }

    return grant;
  };

  return {
    file_scopes: nearestScopes(changedFiles, "max_files", policy.size_gate.max_files, grantAt),
    line_scopes: nearestScopes(changedFiles, "max_lines", policy.size_gate.max_lines, grantAt),
    invalid_folder_files: [...cache].flatMap(([rel, grant]) => (grant.invalid ? [rel] : [])).sort(),
  };
}

const roofOf = (scopes: ScopeBudget[]) => Math.max(...scopes.map((s) => s.ceiling));

/** Whether the PR fits every per-scope budget and the whole-PR roof (the most generous ceiling in play). */
export function sizeWithinBudgets(files: PRFile[], budgets: EffectiveSize) {
  const byName = new Map(files.map((f) => [f.filename, f]));
  const total = substantiveSize(files);

  for (const [unit, scopes] of [["lines", budgets.line_scopes], ["files", budgets.file_scopes]] as const) {
    for (const scope of scopes) {
      const n = substantiveSize(scope.files.flatMap((name) => byName.get(name) ?? []))[unit];

      if (n > scope.ceiling) {
        return { ok: false, message: `${n} substantive ${unit} in ${scope.path ?? "global"} (ceiling ${scope.ceiling}; ${total.lines}L/${total.files}F total)` };
      }
    }

    const roof = roofOf(scopes);

    if (total[unit] > roof) return { ok: false, message: `${total[unit]} substantive ${unit} across the PR (roof ${roof})` };
  }

  return { ok: true, message: `${total.lines} substantive lines / ${total.files} files (limit ${roofOf(budgets.line_scopes)}/${roofOf(budgets.file_scopes)})` };
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

// Credential shapes that are unambiguous enough to deny on: a match is a key, not a variable named
// like one. Generic high-entropy strings are deliberately absent — they are how a secret scanner
// earns a reputation for noise, and this one denies the PR outright.
const CREDENTIAL_PATTERNS: [string, RegExp][] = [
  ["private key block", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
  ["Anthropic key", /\bsk-ant-[\w-]{20,}/],
  ["OpenAI key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Stripe live key", /\b[sr]k_live_[0-9a-zA-Z]{16,}/],
];

/**
 * Credentials added by the diff, as "path: what it looks like". Added lines only: a key being
 * deleted is a key being removed, and context lines are already in the base.
 */
export function addedSecrets(diff: string): string[] {
  const found: string[] = [];
  let file = "";

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) file = line.slice(6).trim(); // "+++ b/path"
    else if (line.startsWith("+") && !line.startsWith("+++")) {
      const hit = CREDENTIAL_PATTERNS.find(([, re]) => re.test(line));

      if (hit && !found.some((f) => f === `${file}: ${hit[0]}`)) found.push(`${file}: ${hit[0]}`);
    }
  }

  return found;
}

export type PRMeta = {
  title: string;
  diff?: string;
  author: string;
  authorAssociation: string;
  isFork: boolean;
  isDraft: boolean;
  mergeable: string;
  reviews: { user: string; state: string }[];
  files: PRFile[];
  manifestScriptEdits?: string[];
  /** Resolved folder size budgets; when absent, the global size_gate alone applies. */
  sizeBudgets?: EffectiveSize;
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

  const budgets = pr.sizeBudgets ?? resolveSizeOverrides(policy, pr.files.map((f) => f.filename), () => null);
  const sizeCheck = sizeWithinBudgets(pr.files, budgets);
  gates.push({ gate: "size", passed: sizeCheck.ok, message: sizeCheck.message });

  // A committed credential is never auto-approvable, whatever tier the change is: this runs before
  // the model and denies on its own. It reads the diff, not the checkout, so a key that was already
  // in the tree is someone else's problem to rotate, not this PR's gate.
  const secrets = pr.diff ? addedSecrets(pr.diff) : [];

  gates.push({ gate: "secrets", passed: secrets.length === 0, message: secrets.length ? `credential added in ${secrets.join("; ")}` : "no credentials in the diff" });

  const t = tier(policy, pr.files, denied);
  gates.push({ gate: "tier", passed: t.tier !== "T2-never", message: [t.tier, t.sub].filter(Boolean).join(" / ") });

  return { gates, denied, ...t };
}
