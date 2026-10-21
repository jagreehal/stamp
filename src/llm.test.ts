import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { anthropicBaseURL, apiKeyFor, keySource, languageModel, maxOutputTokens, DEFAULT_GUARD, guardRules, parseModelId, reviewWithTools, summarizeRun, timeoutMs } from "./llm.ts";

const Verdict = z.object({ verdict: z.enum(["APPROVE", "REFUSE", "ESCALATE"]), reasoning: z.string() });

const usage = { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 50, text: 50, reasoning: 0 } };

const call = (toolName: string, input: Record<string, string>, id: string) => ({ type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) });

const turn = (...content: (ReturnType<typeof call> | { type: "text"; text: string })[]) => ({
  content,
  finishReason: { unified: content.some((c) => c.type === "tool-call") ? ("tool-calls" as const) : ("stop" as const), raw: undefined },
  usage,
  warnings: [],
});

const repo = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "stamp-llm-"));
  writeFileSync(path.join(dir, "total.ts"), "export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n");

  return dir;
};

const run = (model: MockLanguageModelV4, guard?: string) =>
  reviewWithTools({ modelId: "bedrock:zai.glm-4.7-flash", model, schema: Verdict, system: "Review.", prompt: "Diff here.", repoRoot: repo(), session: "stamp-1-abc", guard });

describe("model ids", () => {
  test("provider:model splits at the first colon, so Bedrock ids keep theirs; a bare id is Anthropic", () => {
    expect(parseModelId("bedrock:anthropic.claude-3-5-sonnet-20241022-v2:0")).toEqual({ provider: "bedrock", model: "anthropic.claude-3-5-sonnet-20241022-v2:0" });
    expect(parseModelId("opencode-go:deepseek-v4-flash")).toEqual({ provider: "opencode-go", model: "deepseek-v4-flash" });
    expect(parseModelId("openrouter:moonshotai/kimi-k3")).toEqual({ provider: "openrouter", model: "moonshotai/kimi-k3" });
    expect(parseModelId("groq:openai/gpt-oss-120b")).toEqual({ provider: "groq", model: "openai/gpt-oss-120b" });
    expect(parseModelId("mistral:mistral-small-latest")).toEqual({ provider: "mistral", model: "mistral-small-latest" });
    expect(parseModelId("deepseek:deepseek-flash")).toEqual({ provider: "deepseek", model: "deepseek-flash" });
    expect(parseModelId("claude-opus-5")).toEqual({ provider: "anthropic", model: "claude-opus-5" });
    expect(parseModelId("qwen3.8-max")).toEqual({ provider: "anthropic", model: "qwen3.8-max" });
  });

  test("STAMP_API_KEY is the key for whichever provider the model names; the provider's own variable is the fallback", () => {
    expect(apiKeyFor("deepseek", { STAMP_API_KEY: "one", DEEPSEEK_API_KEY: "own" })).toBe("one");
    expect(apiKeyFor("deepseek", { DEEPSEEK_API_KEY: "own" })).toBe("own");
    expect(apiKeyFor("opencode-go", { OPENCODE_API_KEY: "oc" })).toBe("oc");
    expect(apiKeyFor("groq", { STAMP_API_KEY: "", GROQ_API_KEY: "g" })).toBe("g");
    // Bedrock: an API key from either variable, else nothing, so the AWS credential chain (OIDC) signs.
    expect(apiKeyFor("bedrock", { STAMP_API_KEY: "one" })).toBe("one");
    expect(apiKeyFor("bedrock", { AWS_BEARER_TOKEN_BEDROCK: "bt" })).toBe("bt");
    expect(apiKeyFor("bedrock", { AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "s" })).toBeUndefined();
    // The run log names the variable, never its value, and says when STAMP_API_KEY wins over the provider's own.
    expect(keySource("bedrock:minimax.minimax-m2.5", { STAMP_API_KEY: "one", AWS_BEARER_TOKEN_BEDROCK: "bt" })).toBe("key from STAMP_API_KEY, over AWS_BEARER_TOKEN_BEDROCK");
    expect(keySource("bedrock:minimax.minimax-m2.5", { AWS_BEARER_TOKEN_BEDROCK: "bt" })).toBe("key from AWS_BEARER_TOKEN_BEDROCK");
    expect(keySource("bedrock:minimax.minimax-m2.5", {})).toBe("AWS credential chain");
    expect(keySource("compatible:m", { STAMP_API_KEY: "one" })).toBe("key from STAMP_API_KEY");
    expect(keySource("groq:openai/gpt-oss-120b", {})).toBe("no key: set GROQ_API_KEY or STAMP_API_KEY");
  });

  test("ANTHROPIC_BASE_URL keeps working in the Anthropic SDK's form, without /v1", () => {
    expect(anthropicBaseURL("https://opencode.ai/zen/go")).toBe("https://opencode.ai/zen/go/v1");
    expect(anthropicBaseURL("https://opencode.ai/zen/go/v1/")).toBe("https://opencode.ai/zen/go/v1");
    expect(anthropicBaseURL("")).toBeUndefined();
  });

  test("a blank provider variable, as a workflow passes an unset one, never reaches a provider SDK as it loads", () => {
    // @ai-sdk/anthropic builds its default client at import, and ANTHROPIC_BASE_URL="" makes that throw.
    const cli = Bun.spawnSync(["bun", "run", path.resolve(import.meta.dir, "cli.ts")], { env: { ...process.env, ANTHROPIC_BASE_URL: "", AWS_BEARER_TOKEN_BEDROCK: "" }, cwd: import.meta.dir });

    expect(cli.stderr.toString()).not.toContain("baseURL");
    expect(cli.exitCode).toBe(2); // the usage message: the CLI got past its imports
  });
});

describe("the review loop", () => {
  test("reads the code, then submits a verdict that matches the schema, with a run record", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [turn(call("read_file", { path: "total.ts" }, "1")), turn(call("submit_verdict", { verdict: "APPROVE", reasoning: "reduce starts at 0" }, "2"))] });
    const result = await run(model);

    expect(result.output).toEqual({ verdict: "APPROVE", reasoning: "reduce starts at 0" });
    expect(result.run).toMatchObject({ model: "bedrock:zai.glm-4.7-flash", steps: 2, toolCalls: 1, failedToolCalls: 0, inputTokens: 2000, outputTokens: 100, forcedVerdict: false });
    const toolResult = JSON.stringify(model.doGenerateCalls[1]!.prompt);

    expect(toolResult).toContain("1\\texport const total");
  });

  test("a path outside the repository fails as a tool error, which the record counts", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [turn(call("read_file", { path: "../../etc/passwd" }, "1")), turn(call("submit_verdict", { verdict: "ESCALATE", reasoning: "could not read" }, "2"))] });
    const result = await run(model);

    expect(result.run).toMatchObject({ toolCalls: 1, failedToolCalls: 1 });
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain("path escapes the repository");
  });

  test("git's own files are refused, so a token in .git/config never reaches the model", async () => {
    const dir = repo();

    mkdirSync(path.join(dir, ".git"));
    writeFileSync(path.join(dir, ".git", "config"), "[http] extraheader = AUTHORIZATION: basic c2VjcmV0");
    const model = new MockLanguageModelV4({ doGenerate: [turn(call("read_file", { path: ".git/config" }, "1")), turn(call("read_file", { path: "sub/../.git/config" }, "2")), turn(call("read_file", { path: ".GIT/config" }, "3")), turn(call("submit_verdict", { verdict: "ESCALATE", reasoning: "x" }, "4"))] });
    const result = await reviewWithTools({ modelId: "bedrock:zai.glm-4.7-flash", model, schema: Verdict, system: "Review.", prompt: "Diff.", repoRoot: dir, session: "s" });
    const seen = JSON.stringify(model.doGenerateCalls.map((c) => c.prompt));

    expect(result.run.failedToolCalls).toBe(3);
    expect(seen).toContain("path is inside .git");
    expect(seen).not.toContain("c2VjcmV0");
  });

  test("a model that answers in prose gets one call that must be submit_verdict", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [turn({ type: "text", text: "Looks fine to me." }), turn(call("submit_verdict", { verdict: "APPROVE", reasoning: "fine" }, "1"))] });
    const result = await run(model);

    expect(result.output?.verdict).toBe("APPROVE");
    expect(result.run.forcedVerdict).toBe(true);
    expect(model.doGenerateCalls[1]!.toolChoice).toEqual({ type: "tool", toolName: "submit_verdict" });
  });

  test("a model that ignores the first forced call gets one more before the review errors", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [turn({ type: "text", text: "Looks fine." }), turn({ type: "text", text: "Still fine." }), turn(call("submit_verdict", { verdict: "ESCALATE", reasoning: "unsure" }, "1"))] });
    const result = await run(model);

    expect(result.output).toEqual({ verdict: "ESCALATE", reasoning: "unsure" });
    expect(model.doGenerateCalls.at(-1)?.toolChoice).toEqual({ type: "required" });
  });

  test("a guard rule stops a runaway loop and says which rule fired", async () => {
    const reads = Array.from({ length: 6 }, (_, i) => turn(call("read_file", { path: "total.ts" }, String(i))));

    await expect(run(new MockLanguageModelV4({ doGenerate: reads }), "max-tools:2")).rejects.toThrow(/review stopped: /);
  });

  test("the summary names the model, the tool calls, the cost and the time", () => {
    const record = { model: "opencode-go:kimi-k3", steps: 3, toolCalls: 1, failedToolCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: null, durationMs: 6200, forcedVerdict: false, limits: DEFAULT_GUARD };

    expect(summarizeRun(record)).toBe("opencode-go:kimi-k3 · 1 tool call · unpriced, token cap 3m · 6.2s");
    expect(summarizeRun({ ...record, toolCalls: 9, costUsd: 0.0042 })).toBe("opencode-go:kimi-k3 · 9 tool calls · $0.0042 · 6.2s");
  });

  test("a model call that hangs is cut off at the timeout, not after it returns", async () => {
    const hung = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_, reject) => {
          const late = setTimeout(() => reject(new Error("returned late")), 2000);

          abortSignal?.addEventListener("abort", () => (clearTimeout(late), reject(abortSignal.reason)));
        }),
    });

    const begun = Date.now();

    await expect(run(hung, "timeout:50ms")).rejects.toThrow("review stopped: timed out after 50ms");
    expect(Date.now() - begun).toBeLessThan(1000);
  });

  test("a malformed STAMP_PRICING fails the review that reads it, with the field it rejected", async () => {
    process.env.STAMP_PRICING = '{"kimi-k3":{"inputPer1M":"three"}}';

    try {
      const model = new MockLanguageModelV4({ doGenerate: [turn(call("submit_verdict", { verdict: "APPROVE", reasoning: "ok" }, "1"))] });

      await expect(run(model)).rejects.toThrow(/pricing: kimi-k3.inputPer1M/);
    } finally {
      delete process.env.STAMP_PRICING;
    }
  });
});

describe("limits", () => {
  test("a dollar budget without a price falls back to a token ceiling; an explicit token ceiling or a price leaves the rules alone", () => {
    expect(guardRules("budget:$2,timeout:15m", false)).toBe("budget:$2,timeout:15m,tokens:3m");
    expect(guardRules("budget:$2,tokens:500k", false)).toBe("budget:$2,tokens:500k");
    expect(guardRules("budget:$2,timeout:15m", true)).toBe("budget:$2,timeout:15m");
    expect(guardRules("max-tools:10", false)).toBe("max-tools:10");
  });

  test("the timeout rule reads in ms, s, m and h, seconds when bare", () => {
    expect(timeoutMs("budget:$2,timeout:15m")).toBe(900_000);
    expect(timeoutMs("timeout:50ms")).toBe(50);
    expect(timeoutMs("timeout:30")).toBe(30_000);
    expect(timeoutMs("timeout:1h")).toBe(3_600_000);
    expect(timeoutMs("budget:$2")).toBeNull();
  });
});

test("the output ceiling fits the model: Nova's 10k limit, 16k elsewhere, STAMP_MAX_OUTPUT_TOKENS over both", () => {
  expect(maxOutputTokens("bedrock:eu.amazon.nova-micro-v1:0", "")).toBe(10_000);
  expect(maxOutputTokens("bedrock:amazon.nova-lite-v1:0", "")).toBe(10_000);
  expect(maxOutputTokens("bedrock:zai.glm-4.7-flash", "")).toBe(16_000);
  expect(maxOutputTokens("claude-opus-5", "4000")).toBe(4000);
  expect(maxOutputTokens("claude-opus-5", "lots")).toBe(16_000);
});

test("openai: is the OpenAI API, and compatible: reaches any OpenAI-compatible endpoint named by STAMP_BASE_URL", () => {
  const saved = process.env.STAMP_BASE_URL;

  try {
    delete process.env.STAMP_BASE_URL;
    const Built = z.object({ provider: z.string(), modelId: z.string() });

    expect(Built.parse(languageModel("openai:gpt-5.5", "s")).provider).toBe("openai.responses");
    expect(() => languageModel("compatible:grok-5", "s")).toThrow("STAMP_BASE_URL");
    process.env.STAMP_BASE_URL = "https://api.x.ai/v1";
    const m = Built.parse(languageModel("compatible:grok-5", "s"));

    expect(m.provider).toBe("compatible.chat");
    expect(m.modelId).toBe("grok-5");
  } finally {
    if (saved === undefined) delete process.env.STAMP_BASE_URL;
    else process.env.STAMP_BASE_URL = saved;
  }
});
