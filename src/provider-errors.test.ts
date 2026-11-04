import { expect, test } from "bun:test";
import { explainFailure, failureText } from "./provider-errors.ts";

test("a billing failure names the fix and the provider's page, ahead of the status code it arrives with", () => {
  expect(explainFailure('{"status": 401, "error": "Insufficient Balance"}', "deepseek")).toBe("Out of credit or over a spending cap: top up the account or raise the cap (https://platform.deepseek.com/top_up).");
  expect(explainFailure("You have reached your specified API usage limits. You will regain access on 2026-09-01 at 00:00 UTC.", "anthropic")).toContain("platform.claude.com");
  // No page without a provider stamp knows: a CLI backend's plan is not the API account.
  expect(explainFailure("Your credit balance is too low")).toBe("Out of credit or over a spending cap: top up the account or raise the cap.");
});

test("each failure gets its own remedy, and the first match wins", () => {
  expect(explainFailure("You've hit your usage limit. Try again at 7:58 AM.")).toContain("reset");
  expect(explainFailure("Failed after 3 attempts. Last error: AI_APICallError: Go usage limit exceeded")).toContain("reset");
  expect(explainFailure("No endpoints available matching your data policy")).toContain("data policy");
  expect(explainFailure("Model not found: qwen9")).toContain("does not serve");
  expect(explainFailure("This model's maximum context length is 200000 tokens")).toContain("context window");
  expect(explainFailure('status: 403\nx-ratelimit-remaining: 0')).toContain("refused the key");
  expect(explainFailure("rate_limit_error")).toContain("Rate limited");
  expect(explainFailure("529 Overloaded")).toContain("outage");
  expect(explainFailure("http_status=503")).toContain("outage");
  expect(explainFailure("http_status=503")).toContain("outage");
});

test("a number that only looks like a status, a rate-limit header, and stamp's own errors are not provider failures", () => {
  expect(explainFailure("commit a429f00 could not be read")).toBeNull();
  expect(explainFailure("x-ratelimit-remaining: 10")).toBeNull();
  expect(explainFailure("reviewer ended without a verdict: the quota logic here is wrong")).toBeNull();
  expect(explainFailure("review stopped: budget exceeded, rate limit")).toBeNull();
  expect(explainFailure('claude returned an invalid result: {"result":"rate limit logic"}')).toBeNull();
  expect(explainFailure("write /tmp/x: disk quota exceeded")).toBeNull();
});

test("the AI SDK's status and body count, on the error or on the last retry", () => {
  const forbidden = Object.assign(new Error("Forbidden"), { statusCode: 403, responseBody: "{}" });

  expect(explainFailure(failureText(forbidden))).toContain("refused the key");
  expect(explainFailure(failureText(Object.assign(new Error("Failed after 3 attempts"), { lastError: { statusCode: 529 } })))).toContain("outage");
  expect(failureText(new Error("plain"))).toBe("plain");
});
