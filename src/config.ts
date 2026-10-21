// Every setting stamp reads, resolved in one place. A non-blank environment variable wins, then the policy on the
// default branch, then the built-in default. Settings live in .stamp/policy.yml so a change to one is reviewed like
// any policy change; the variables stay for experiments. Secrets never go in the policy: they are env-only, and
// `stamp config` reports them as set or unset, never their values.
import type { Policy } from "./policy.ts";

/** Credentials stamp reads. Env-only, never printed. */
export const SECRETS = ["STAMP_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENCODE_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "AI_GATEWAY_API_KEY", "AWS_BEARER_TOKEN_BEDROCK", "CLAUDE_CODE_OAUTH_TOKEN", "CODEX_API_KEY", "TYPESAFE_API_KEY", "OTEL_EXPORTER_OTLP_HEADERS", "STAMP_SLACK_WEBHOOK", "STAMP_NOTIFY_WEBHOOK", "GH_TOKEN"];

type Env = Record<string, string | undefined>;

export type Settings = Pick<Policy, "model" | "backends" | "pricing" | "provider" | "guard" | "max_output_tokens" | "cli" | "label" | "notify" | "telemetry" | "advise_on_deny">;

export type GuardSettings = NonNullable<Settings["guard"]>;

/** autotel's guard shorthand, in the order stamp has always written it. */
export function guardShorthand(g: GuardSettings): string {
  return [
    g.budget_usd !== undefined && `budget:$${g.budget_usd}`,
    g.tokens !== undefined && `tokens:${g.tokens}`,
    g.loop !== undefined && `loop:${g.loop}`,
    g.max_tools !== undefined && `max-tools:${g.max_tools}`,
    g.timeout !== undefined && `timeout:${g.timeout}`,
  ]
    .filter(Boolean)
    .join(",");
}

export const DEFAULT_GUARD: GuardSettings = { budget_usd: 2, tokens: "3m", loop: "4/12", max_tools: 80, timeout: "15m" };

/** Each setting: its policy key (as `stamp config` shows it), the variables that override it, its value in a policy, and its default. "" is unset. */
const SETTINGS = {
  model: { key: "model", env: ["STAMP_MODEL"], from: (p: Settings) => p.model, fallback: "claude-opus-5" },
  backends: { key: "backends", env: ["STAMP_BACKENDS", "STAMP_BACKEND"], from: (p: Settings) => p.backends?.join(","), fallback: "api" },
  pricing: { key: "pricing", env: ["STAMP_PRICING"], from: (p: Settings) => p.pricing && JSON.stringify(p.pricing), fallback: "" },
  region: { key: "provider.region", env: ["AWS_REGION"], from: (p: Settings) => p.provider?.region, fallback: "" },
  base_url: { key: "provider.base_url", env: ["STAMP_BASE_URL"], from: (p: Settings) => p.provider?.base_url, fallback: "" },
  anthropic_base_url: { key: "provider.anthropic_base_url", env: ["ANTHROPIC_BASE_URL"], from: (p: Settings) => p.provider?.anthropic_base_url, fallback: "" },
  // A partial `guard:` keeps the default for every rule it leaves out; STAMP_GUARD replaces the whole set, as it always has.
  guard: { key: "guard", env: ["STAMP_GUARD"], from: (p: Settings) => p.guard && guardShorthand({ ...DEFAULT_GUARD, ...p.guard }), fallback: guardShorthand(DEFAULT_GUARD) },
  max_output_tokens: { key: "max_output_tokens", env: ["STAMP_MAX_OUTPUT_TOKENS"], from: (p: Settings) => p.max_output_tokens?.toString(), fallback: "" },
  claude_model: { key: "cli.claude_model", env: ["STAMP_CLAUDE_MODEL"], from: (p: Settings) => p.cli?.claude_model, fallback: "" },
  codex_model: { key: "cli.codex_model", env: ["STAMP_CODEX_MODEL"], from: (p: Settings) => p.cli?.codex_model, fallback: "" },
  label: { key: "label", env: ["STAMP_LABEL"], from: (p: Settings) => p.label, fallback: "" },
  notify_on: { key: "notify.on", env: ["STAMP_NOTIFY_ON"], from: (p: Settings) => p.notify?.on?.join(","), fallback: "REFUSED,ESCALATE,ERROR" },
  telemetry_endpoint: { key: "telemetry.endpoint", env: ["OTEL_EXPORTER_OTLP_ENDPOINT"], from: (p: Settings) => p.telemetry?.endpoint, fallback: "" },
  telemetry_service: { key: "telemetry.service", env: ["OTEL_SERVICE_NAME"], from: (p: Settings) => p.telemetry?.service, fallback: "stamp" },
  advise_on_deny: { key: "advise_on_deny", env: ["STAMP_ADVISE_ON_DENY"], from: (p: Settings) => p.advise_on_deny?.toString(), fallback: "false" },
};

export type Setting = keyof typeof SETTINGS;

export type Resolved = { value: string; source: "env" | "policy" | "default"; key: string; env: string };

/** One setting: the first non-blank variable, else the policy's value, else the default. */
export function resolve(name: Setting, policy: Settings = {}, env: Env = process.env): Resolved {
  const s = SETTINGS[name];
  const fromEnv = s.env.find((k) => env[k]?.trim());

  if (fromEnv) return { value: env[fromEnv]!.trim(), source: "env", key: s.key, env: fromEnv }; // SAFETY: find() matched a non-blank env[fromEnv]

  const fromPolicy = s.from(policy);

  return fromPolicy !== undefined && fromPolicy !== "" ? { value: fromPolicy, source: "policy", key: s.key, env: s.env[0]! } : { value: s.fallback, source: "default", key: s.key, env: s.env[0]! };
}

let active: Settings = {};

/** Make the trusted policy's settings the ones every later read sees. Until then, reads see the environment and the defaults. */
export function useSettings(policy: Settings): void {
  active = policy;
}

/** A setting's effective value, read when it is used, so a variable set later still wins. "" is unset. */
export const setting = (name: Setting): string => resolve(name, active).value;

/** Every setting, with where it came from, and every secret as set or unset. What `stamp config` prints. */
export function effectiveConfig(policy: Settings = active, env: Env = process.env) {
  // A URL's user:password is a credential: shown redacted, like the secrets below. Up to the authority's last `@`,
  // so a password holding a raw `@` is redacted whole.
  const shown = (name: Setting) => {
    const r = resolve(name, policy, env);

    return { ...r, value: r.value.replace(/\/\/[^/\s]*@/, "//[redacted]@") };
  };

  // SAFETY: Object.keys of the SETTINGS literal is exactly Setting.
  const names = Object.keys(SETTINGS) as Setting[];

  return {
    settings: Object.fromEntries(names.map((k) => [k, shown(k)])),
    secrets: Object.fromEntries(SECRETS.map((k) => [k, env[k]?.trim() ? "set" : "unset"])),
  };
}

/** One line naming every setting that did not come from its default, for the start of a review log. */
export function configSummary(policy: Settings = active, env: Env = process.env): string {
  const changed = Object.values(effectiveConfig(policy, env).settings).filter((r) => r.source !== "default");

  return `config: ${changed.length ? changed.map((r) => `${r.key} from ${r.source === "env" ? r.env : "policy"}`).join(", ") : "all defaults"} (stamp config shows every value)`;
}
