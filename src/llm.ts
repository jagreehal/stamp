// The api backend: one AI SDK tool loop on any provider. The model reads the checkout through three tools
// confined to the repository and ends by calling submit_verdict, whose input is the verdict schema; tool
// calling is the one capability every supported provider shares.
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createBedrockAnthropic } from "@ai-sdk/amazon-bedrock/anthropic";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { gateway, generateText, hasToolCall, stepCountIs, tool, type LanguageModel, type ModelMessage, type StepResult, type ToolSet } from "ai";
import { BEDROCK_PRICING } from "autotel-bedrock";
import { estimateLLMCost, registerModelPricing } from "autotel-genai/cost";
import { createGenAiGuard, parseGuardRules } from "autotel-genai/guard";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// Prices for any model autotel's tables leave out, per million tokens:
// STAMP_PRICING='{"kimi-k3":{"inputPer1M":3,"outputPer1M":15,"cachedInputPer1M":0.3}}'.
const Pricing = z.record(z.string(), z.object({ inputPer1M: z.number(), outputPer1M: z.number(), cachedInputPer1M: z.number().optional() }).strict());

registerModelPricing(BEDROCK_PRICING);

let pricingLoadedFor: string | undefined;

/** Register STAMP_PRICING at review time: a malformed value fails that review as ERROR, never the CLI's startup or its retraction of a stale approval. */
function loadPricing(): void {
  if (pricingLoadedFor === process.env.STAMP_PRICING) return;

  if (process.env.STAMP_PRICING) {
    let json: unknown;

    try {
      json = JSON.parse(process.env.STAMP_PRICING);
    } catch {
      throw new Error("STAMP_PRICING: not valid JSON");
    }

    const parsed = Pricing.safeParse(json);

    if (!parsed.success) throw new Error(`STAMP_PRICING: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    registerModelPricing(parsed.data);
  }

  pricingLoadedFor = process.env.STAMP_PRICING;
}

const PROVIDERS = ["anthropic", "bedrock", "opencode", "opencode-go", "openrouter", "gateway"] as const;

type Provider = (typeof PROVIDERS)[number];

const isProvider = (p: string): p is Provider => PROVIDERS.some((known) => known === p);

/** `provider:model`, split at the first colon (Bedrock ids carry colons of their own). A bare id is Anthropic. */
export function parseModelId(id: string): { provider: Provider; model: string } {
  const at = id.indexOf(":");
  const provider = id.slice(0, at);

  return at > 0 && isProvider(provider) ? { provider, model: id.slice(at + 1) } : { provider: "anthropic", model: id };
}

/** ANTHROPIC_BASE_URL in the Anthropic SDK's convention (no /v1, e.g. https://opencode.ai/zen/go), as the AI SDK wants it. */
export function anthropicBaseURL(raw = process.env.ANTHROPIC_BASE_URL): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.replace(/\/+$/, "");

  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

/** Every variable a provider reads its credentials or endpoint from. The workflow template passes each one. */
export const PROVIDER_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "OPENCODE_API_KEY", "OPENROUTER_API_KEY", "AI_GATEWAY_API_KEY", "AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION"];

const OPENCODE = { opencode: "https://opencode.ai/zen/v1", "opencode-go": "https://opencode.ai/zen/go/v1" } as const;

/**
 * The AI SDK model for an id. `session` names the review for gateways that route by conversation (OpenCode
 * requires `x-opencode-session`); other hosts ignore the header.
 */
export function languageModel(id: string, session: string): LanguageModel {
  // A workflow passes an unset secret or variable as "", which providers read as a value: a blank
  // AWS_BEARER_TOKEN_BEDROCK would replace the OIDC credentials with an empty key.
  for (const k of PROVIDER_ENV) if (process.env[k] === "") delete process.env[k];
  const { provider, model } = parseModelId(id);
  const headers = { "x-opencode-session": session, "User-Agent": "stamp (pr-review)" };

  switch (provider) {
    case "bedrock":
      // Claude on Bedrock through InvokeModel (prompt caching, native features); everything else through Converse.
      return model.includes("anthropic.") ? createBedrockAnthropic()(model) : createAmazonBedrock()(model);
    case "opencode":
    case "opencode-go": {
      const baseURL = OPENCODE[provider];
      const apiKey = process.env.OPENCODE_API_KEY;

      if (/^(gpt|grok)-/.test(model)) return createOpenAI({ baseURL, apiKey, headers }).responses(model);

      if (model.startsWith("claude-")) return createAnthropic({ baseURL, apiKey, headers })(model);

      return createOpenAICompatible({ name: provider, baseURL, apiKey, headers })(model);
    }

    case "openrouter":
      return createOpenAICompatible({ name: "openrouter", baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY, headers })(model);
    case "gateway":
      return gateway(model);
    case "anthropic":
      return createAnthropic({ baseURL: anthropicBaseURL(), headers })(model);
  }
}

/** read_file, grep and glob over the checkout. Every path resolves inside the repository, through symlinks. */
export function repoTools(root: string) {
  const real = realpathSync(root);

  const inside = (p: string) => {
    const abs = path.resolve(real, p);
    let target = abs;

    try {
      target = realpathSync(abs);
    } catch {
      // A missing file: the lexical path is still checked.
    }

    if (!abs.startsWith(real + path.sep) && abs !== real) throw new Error("path escapes the repository");

    if (!target.startsWith(real + path.sep) && target !== real) throw new Error("path escapes the repository (symlink)");

    // Git's own files are no part of the review, and .git/config can hold a token.
    if ([abs, target].some((p) => path.relative(real, p).toLowerCase().split(path.sep).includes(".git"))) throw new Error("path is inside .git");

    return abs;
  };

  const git = (args: string[]) => {
    try {
      return execFileSync("git", ["-C", real, ...args], { encoding: "utf8", maxBuffer: 8 << 20 });
    } catch (e) {
      // git grep exits 1 for "no matches", which is an answer.
      if (e instanceof Error && "status" in e && e.status === 1) return "(no matches)";
      throw e;
    }
  };

  return {
    read_file: tool({
      description: "Read a file from the repository, with 1-based line numbers. Use offset/limit for large files.",
      inputSchema: z.object({ path: z.string(), offset: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(2000).optional() }),
      execute: async ({ path: p, offset = 1, limit = 400 }) =>
        readFileSync(inside(p), "utf8")
          .split("\n")
          .slice(offset - 1, offset - 1 + limit)
          .map((l, i) => `${offset + i}\t${l}`)
          .join("\n"),
    }),
    grep: tool({
      description: "Search tracked files with an extended regex (git grep -nE). Optional path prefix to narrow.",
      inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
      execute: async ({ pattern, path: p }) => git(["grep", "-nIE", "--", pattern, ...(p ? [inside(p)] : [])]).slice(0, 20_000),
    }),
    glob: tool({
      description: "List tracked files matching a glob, e.g. 'src/**/*.ts'.",
      inputSchema: z.object({ pattern: z.string() }),
      execute: async ({ pattern }) => git(["ls-files", "--", pattern]).slice(0, 20_000),
    }),
  };
}

/** What one review cost and did: the evidence bundle carries it, and the mechanics table shows its summary. */
export type RunRecord = {
  model: string;
  steps: number;
  toolCalls: number;
  failedToolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number | null;
  durationMs: number;
  forcedVerdict: boolean;
  /** The guard rules the run ran under, after any fallback for an unpriced model. */
  limits: string;
};

export const summarizeRun = (run: RunRecord) =>
  `${run.model} · ${run.toolCalls} tool call${run.toolCalls === 1 ? "" : "s"} · ${run.costUsd === null ? `unpriced, ${tokenCap(run.limits) ?? "no token cap"}` : `$${run.costUsd.toFixed(4)}`} · ${(run.durationMs / 1000).toFixed(1)}s`;

/**
 * Limits for one review, in autotel's guard shorthand (STAMP_GUARD replaces them): a cost ceiling, a token
 * ceiling that still holds when the model has no price, spin-loop and tool-call limits, and a wall-clock
 * timeout that also aborts a model call in flight.
 */
export const DEFAULT_GUARD = "budget:$2,tokens:3m,loop:4/12,max-tools:80,timeout:15m";

/** The token ceiling an unpriced model falls back to when the rules set a dollar budget and no token ceiling. */
const UNPRICED_TOKEN_CAP = "tokens:3m";

const rule = (rules: string, name: string) => rules.split(",").map((r) => r.trim()).find((r) => r.startsWith(`${name}:`));

const tokenCap = (rules: string) => rule(rules, "tokens")?.replace("tokens:", "token cap ");

/** The guard rules for a model: a dollar budget means nothing without a price, so a token ceiling stands in. */
export function guardRules(rules: string, priced: boolean): string {
  return !priced && (rule(rules, "budget") || rule(rules, "cost")) && !rule(rules, "tokens") ? `${rules},${UNPRICED_TOKEN_CAP}` : rules;
}

/** The `timeout:` rule in milliseconds (`ms`/`s`/`m`/`h`, seconds by default); null when the rules set none. */
export function timeoutMs(rules: string): number | null {
  const m = /^timeout:(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(rule(rules, "timeout") ?? "");

  if (!m) return null;
  const [, amount = "0", unit = "s"] = m;
  const scale = unit === "ms" ? 1 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 1000;

  return Number(amount) * scale;
}

export type ToolReview<T> = { output: T | null; text: string; refused: boolean; run: RunRecord };

type Options<T> = {
  modelId: string;
  model?: LanguageModel; // tests pass a mock; production resolves modelId
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  repoRoot: string;
  session: string;
  verbose?: boolean;
  guard?: string;
};

const SUBMIT = "submit_verdict";

const MAX_STEPS = 40;

/**
 * Run the review loop and return the submitted verdict. A model that answers in prose instead gets one
 * follow-up call that must be submit_verdict. A guard rule that fires aborts the run and throws, so the
 * caller reports ERROR and nothing is approved.
 */
export async function reviewWithTools<T>(o: Options<T>): Promise<ToolReview<T>> {
  await startTelemetry();
  loadPricing();
  const started = Date.now();
  const { model: pricedAs } = parseModelId(o.modelId);
  const model = o.model ?? languageModel(o.modelId, o.session);
  const limits = guardRules(o.guard ?? (process.env.STAMP_GUARD || DEFAULT_GUARD), estimateLLMCost(pricedAs, { inputTokens: 1, outputTokens: 1 }) !== undefined);
  const guard = createGenAiGuard({ rules: parseGuardRules(limits), onStop: "abort" });
  const deadline = timeoutMs(limits);
  const timer = deadline === null ? null : AbortSignal.timeout(deadline);
  const abortSignal = timer ? AbortSignal.any([guard.signal, timer]) : guard.signal;
  let output: T | null = null;
  const run: RunRecord = { model: o.modelId, steps: 0, toolCalls: 0, failedToolCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: null, durationMs: 0, forcedVerdict: false, limits };

  const tools = {
    ...repoTools(o.repoRoot),
    [SUBMIT]: tool({
      description: "Submit your final verdict. Call it exactly once, when you have decided; it ends the review.",
      inputSchema: o.schema,
      execute: async (verdict) => {
        output = verdict;

        return "Verdict recorded. The review is over.";
      },
    }),
  } satisfies ToolSet;

  const onStepFinish = (step: StepResult<typeof tools>) => {
    const usage = { inputTokens: step.usage.inputTokens ?? 0, outputTokens: step.usage.outputTokens ?? 0, cacheReadInputTokens: step.usage.inputTokenDetails.cacheReadTokens ?? 0 };
    const cost = estimateLLMCost(pricedAs, usage);
    run.steps += 1;
    run.inputTokens += usage.inputTokens;
    run.outputTokens += usage.outputTokens;
    run.cacheReadTokens += usage.cacheReadInputTokens;

    if (cost !== undefined) run.costUsd = (run.costUsd ?? 0) + cost;
    guard.record({ kind: "llm", usage: { costUsd: cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } });

    const failed = new Set(step.content.flatMap((part) => (part.type === "tool-error" ? [part.toolCallId] : [])));

    for (const call of step.toolCalls) {
      if (call.toolName === SUBMIT) continue;
      const error = failed.has(call.toolCallId);
      run.toolCalls += 1;

      if (error) run.failedToolCalls += 1;
      guard.record({ kind: "tool", name: call.toolName, signature: `${call.toolName}:${JSON.stringify(call.input)}`, error });

      if (o.verbose) console.error(`  → ${call.toolName} ${JSON.stringify(call.input)}${error ? " (failed)" : ""}`);
    }
  };

  const instructions = { role: "system" as const, content: o.system, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" as const } } } };
  const common = { model, instructions, tools, maxOutputTokens: 16_000, abortSignal, onStepFinish };

  const guardError = () =>
    new Error(`review stopped: ${timer?.aborted && !guard.stopped ? `timed out after ${rule(limits, "timeout")?.slice("timeout:".length)}` : guard.violations.map((v) => v.message).join("; ")}`);

  const stopped = () => guard.stopped || timer?.aborted === true;

  try {
    const first = await generateText({ ...common, prompt: o.prompt, stopWhen: [hasToolCall(SUBMIT), stepCountIs(MAX_STEPS)] });
    let text = first.text;

    if (first.finishReason === "content-filter") return { output: null, text, refused: true, run: { ...run, durationMs: Date.now() - started } };

    if (output === null) {
      const messages: ModelMessage[] = [{ role: "user", content: o.prompt }, ...first.response.messages, { role: "user", content: `Call ${SUBMIT} now with your verdict.` }];
      const forced = await generateText({ ...common, messages, toolChoice: { type: "tool", toolName: SUBMIT }, stopWhen: stepCountIs(1) });
      run.forcedVerdict = true;
      text = forced.text || text;
    }

    if (stopped()) throw guardError();

    return { output, text, refused: false, run: { ...run, durationMs: Date.now() - started } };
  } catch (e) {
    // A fired guard rule or the timeout surfaces as an AbortError; report which limit it was.
    if (stopped()) throw guardError();
    throw e;
  }
}

let telemetry: Promise<{ shutdown: () => Promise<void> }> | null = null;

/**
 * Traces only when an OTLP endpoint is configured: each review becomes a gen_ai.* span tree (every tool
 * call, tokens, cost). Without one, the OpenTelemetry SDK is never loaded.
 */
export async function startTelemetry(): Promise<void> {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;

  telemetry ??= (async () => {
    const [{ init, shutdown }, { registerTelemetry }, { autotelTelemetry }, { bedrockProviderAttributes }] = await Promise.all([import("autotel"), import("ai"), import("autotel-genai/observer"), import("autotel-bedrock")]);
    init({ service: process.env.OTEL_SERVICE_NAME || "stamp" });
    registerTelemetry(autotelTelemetry({ pricing: BEDROCK_PRICING, providerAttributes: bedrockProviderAttributes }));

    return { shutdown };
  })();
  await telemetry;
}

/** Flush and stop telemetry, if it started. */
export async function stopTelemetry(): Promise<void> {
  if (telemetry) await (await telemetry).shutdown();
}
