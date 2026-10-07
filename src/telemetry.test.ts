import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { z } from "zod";
import { egressDecisions, egressRefusals } from "./isolated-cli.ts";

const OtlpAttribute = z.object({ key: z.string(), value: z.object({ stringValue: z.string().optional(), arrayValue: z.object({ values: z.array(z.object({ stringValue: z.string() })) }).optional() }) });

const OtlpSpan = z.object({ name: z.string(), spanId: z.string(), parentSpanId: z.string().optional(), attributes: z.array(OtlpAttribute), status: z.object({ code: z.number().optional() }).optional() });

const OtlpTraces = z.object({ resourceSpans: z.array(z.object({ scopeSpans: z.array(z.object({ spans: z.array(OtlpSpan) })) })) });

test("a review is one stamp.review span, model spans nest under it, and the verdict lands as attributes", async () => {
  const bodies: string[] = [];

  const server = createServer((req, res) => {
    let body = "";

    req.on("data", (d) => (body += d));
    req.on("end", () => {
      bodies.push(body);
      res.end("{}");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = z.object({ port: z.number() }).parse(server.address());

  // A child process, so autotel's global tracer provider never touches the other tests.
  const script = `
    const { beginReviewSpan, endReviewSpan, inReviewSpan } = await import(${JSON.stringify(path.join(import.meta.dir, "llm.ts"))});
    const { getTracer } = await import("autotel");
    await beginReviewSpan(new Date(Date.now() - 1000).toISOString());
    inReviewSpan(() => getTracer("model").startSpan("gen_ai.chat").end());
    await endReviewSpan({ "stamp.verdict": "ERROR", "stamp.denied": ["auth", "billing"], "stamp.risk": undefined }, true);`;

  const child = spawn("bun", ["-e", script], { cwd: path.join(import.meta.dir, ".."), env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`, OTEL_EXPORTER_OTLP_PROTOCOL: "http/json" } });

  await new Promise((resolve) => child.on("exit", resolve));
  server.close();

  const spans = bodies.flatMap((b) => OtlpTraces.parse(JSON.parse(b)).resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans)));
  const review = spans.find((s) => s.name === "stamp.review");
  const attr = (key: string) => review?.attributes.find((a) => a.key === key)?.value;

  expect(spans.find((s) => s.name === "gen_ai.chat")?.parentSpanId).toBe(review?.spanId);
  expect(attr("stamp.verdict")?.stringValue).toBe("ERROR");
  expect(attr("stamp.denied")?.arrayValue?.values.map((v) => v.stringValue)).toEqual(["auth", "billing"]);
  expect(attr("stamp.risk")).toBeUndefined();
  expect(review?.status?.code).toBe(2);
});

test("without an OTLP endpoint the review runs with no span and no SDK", async () => {
  const { beginReviewSpan, endReviewSpan, inReviewSpan } = await import("./llm.ts");
  const saved = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  try {
    await beginReviewSpan(new Date().toISOString());
    expect(inReviewSpan(() => 42)).toBe(42);
    await endReviewSpan({ "stamp.verdict": "APPROVED" }, false);
  } finally {
    if (saved !== undefined) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = saved;
  }
});

test("egress decisions are counts by kind, never the hosts or names a reviewer chose", () => {
  // A hijacked reviewer picks the target and the TLS name; either could carry an encoded secret.
  const secret = "c2stcHJvai1zZWNyZXQ";
  const logs = ["stamp egress ready", "allow api.openai.com:443", `deny ${secret}.example.com:443`, "allow api.openai.com:443", "deny chatgpt.com:443", `deny api.openai.com:443 sni ${secret}.example.com`, "refuse 172.17.0.3"].join("\n");
  const decisions = egressDecisions(logs);

  expect(decisions).toEqual({ allowed: 2, deniedHost: 2, deniedName: 1, refused: 1 });
  expect(egressRefusals([decisions, undefined])).toBe("2 to another host, 1 with another TLS name, 1 from outside the review network");
  expect(JSON.stringify(decisions) + egressRefusals([decisions])).not.toContain(secret);
  expect(egressRefusals([egressDecisions("allow api.openai.com:443")])).toBe("");
});
