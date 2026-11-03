// Turns a provider's error text ("Forbidden", a JSON dump, a 400 naming a spend cap) into the fix an ERROR review shows.
// Advisory: verdicts stay as they are.
import { z } from "zod";

const BILLING = "Out of credit or over a spending cap: top up the account or raise the cap";

const AUTH = "The provider refused the key: `stamp config` shows which key is set, and the run log names the one used";

const RATE = "Rate limited: rerun with `/stamp` once it clears, or raise the provider's limit";

const OUTAGE = "A provider outage, not this PR: rerun with `/stamp`";

// Provider wordings, lowercase, most specific remedy first. They come ahead of the status code: billing errors often
// arrive as a 401 or 429.
const SPECIFIC: [string, string[]][] = [
  [BILLING, ["creditserror", "freeusagelimiterror", "insufficient balance", "insufficient credits", "insufficient account funds", "no credits remaining", "out of credits", "credit balance is too low", "used all available credits", "requires more credits", "spending cap", "spending limit", "key limit exceeded", "check your plan and billing", "free_tier_requests", "specified api usage limits", "free usage exceeded"]],
  ["A plan's usage window ran out: wait for it to reset or raise the limit", ["usage limit has been reached", "hit your usage limit", "usage limit reached", "usage limit exceeded"]],
  ["The router's data policy or guardrails exclude every provider of this model: widen them or pick another model", ["no endpoints available matching"]],
  ["The provider does not serve this model: check `model` in .stamp/policy.yml", ["model not found", "model_not_found", "modelnotfound", "does not exist or you do not have access"]],
  ["The prompt exceeds the model's context window: use a model with a longer one, or a human reviews this PR", ["prompt is too long", "exceeds context window", "maximum context length", "context_length_exceeded"]],
];

// Read when no status code settled it. "rate limit" needs its separator, which keeps `x-ratelimit-*` headers out.
const GENERAL: [string, string[]][] = [
  [AUTH, ["user not found", "invalid authentication", "no auth credentials", "invalid api key", "invalid_api_key"]],
  [RATE, ["rate limit", "rate_limit", "resource_exhausted", "insufficient_quota", "exceeded your current quota"]],
  [OUTAGE, ["overloaded", "provider_unavailable", "model is at capacity"]],
];

const matching = (table: [string, string[]][], text: string) => table.find(([, says]) => says.some((s) => text.includes(s)))?.[0];

/** The remedy for a status code written beside its key, so a commit SHA holding "429" is no rate limit. */
function byStatus(text: string): string | undefined {
  const code = Number(/\b(?:http[_ ]?)?status(?:[_ ]?code)?["']?\s*[:=]\s*["']?(\d{3})\b/.exec(text)?.[1]);

  if (code === 401 || code === 403) return AUTH;

  if (code === 429) return RATE;

  return code >= 500 ? OUTAGE : undefined;
}

// Where each provider's billing lives, by stamp's provider name.
const BILLING_PAGE = new Map([
  ["anthropic", "https://platform.claude.com/settings/billing"],
  ["bedrock", "https://console.aws.amazon.com/billing/home"],
  ["openai", "https://platform.openai.com/settings/organization/billing/overview"],
  ["opencode", "https://opencode.ai/zen"],
  ["opencode-go", "https://opencode.ai/go"],
  ["openrouter", "https://openrouter.ai/settings/credits"],
  ["deepseek", "https://platform.deepseek.com/top_up"],
]);

const ApiFailure = z.object({ statusCode: z.number().optional(), responseBody: z.string().optional() });

const Failure = ApiFailure.extend({ lastError: ApiFailure.optional() });

/** Everything an error says about its cause. The AI SDK keeps the status and body off the message, and a retried call inside `lastError`. */
export function failureText(e: Error): string {
  const f = Failure.safeParse(e);

  if (!f.success) return e.message;

  return [e.message, ...[f.data, f.data.lastError].flatMap((x) => [x?.responseBody ?? "", x?.statusCode ? `status: ${x.statusCode}` : ""])].filter(Boolean).join("\n");
}

/**
 * The fix for a provider's error, or null for any other text. `reviewer …`, `review stopped …` and `claude returned …` are stamp's
 * own errors and quote the model, so they stay out. `provider`, on the api backend, adds the billing page.
 */
export function explainFailure(text: string, provider?: string): string | null {
  if (/^(reviewer |review stopped|claude returned)/.test(text)) return null;
  const lower = text.toLowerCase();
  const fix = matching(SPECIFIC, lower) ?? byStatus(lower) ?? matching(GENERAL, lower);

  if (!fix) return null;
  const page = fix === BILLING && provider ? BILLING_PAGE.get(provider) : undefined;

  return `${fix}${page ? ` (${page})` : ""}.`;
}
