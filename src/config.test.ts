import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { configSummary, effectiveConfig, resolve } from "./config.ts";
import { PolicySchema, STAMP_VERSION, parsePolicy, policyJsonSchema, policyWithSettings } from "./policy.ts";

const bundled = () => readFileSync(path.resolve(import.meta.dir, "../.stamp/policy.yml"), "utf8");

describe("settings", () => {
  test("a non-blank variable wins, then the policy, then the default; a blank or whitespace variable counts as unset", () => {
    const policy = { model: "bedrock:minimax.minimax-m2.5", provider: { region: "eu-west-1" } };

    expect(resolve("model", policy, { STAMP_MODEL: "openai:gpt-5.5" })).toMatchObject({ value: "openai:gpt-5.5", source: "env", env: "STAMP_MODEL" });
    expect(resolve("model", policy, { STAMP_MODEL: "" })).toMatchObject({ value: "bedrock:minimax.minimax-m2.5", source: "policy" });
    expect(resolve("model", policy, { STAMP_MODEL: "  " }).source).toBe("policy");
    expect(resolve("model", {}, {})).toMatchObject({ value: "claude-opus-5", source: "default" });
    expect(resolve("region", policy, {}).value).toBe("eu-west-1");
    // STAMP_BACKENDS, then the older single STAMP_BACKEND, override `backends`
    expect(resolve("backends", { backends: ["api", "codex"] }, { STAMP_BACKEND: "claude" })).toMatchObject({ value: "claude", env: "STAMP_BACKEND" });
    expect(resolve("backends", { backends: ["api", "codex"] }, {}).value).toBe("api,codex");
    expect(configSummary(policy, { STAMP_GUARD: "budget:$5" })).toBe("config: model from policy, provider.region from policy, guard from STAMP_GUARD (stamp config shows every value)");
  });

  test("guard: structured in the policy, any rule left out keeps its default, and STAMP_GUARD replaces the set", () => {
    expect(resolve("guard", {}, {}).value).toBe("budget:$2,tokens:3m,loop:4/12,max-tools:80,timeout:15m");
    expect(resolve("guard", { guard: { budget_usd: 0.5, timeout: "5m" } }, {}).value).toBe("budget:$0.5,tokens:3m,loop:4/12,max-tools:80,timeout:5m");
    expect(resolve("guard", { guard: { budget_usd: 0.5 } }, { STAMP_GUARD: "tokens:1m" }).value).toBe("tokens:1m");

    const valid = (guard: Record<string, string | number>) => PolicySchema.safeParse({ ...parseYaml(bundled()), guard }).success;

    expect(valid({ budget_usd: 1, tokens: "500k", loop: "3/10", max_tools: 40, timeout: "10m" })).toBe(true);
    expect(valid({ tokens: 2_000_000 })).toBe(true);
    expect(valid({ budget_usd: -1 })).toBe(false);
    expect(valid({ timeout: "soon" })).toBe(false);
    expect(valid({ max_tool: 40 })).toBe(false);
  });

  test("stamp config shows settings and where they came from, secrets only as set or unset, and no URL credentials", () => {
    const canary = "sk-ant-api03-stamp-config-canary-value";
    const config = effectiveConfig({ provider: { base_url: "https://user:hunter2@llm.internal/v1" } }, { ANTHROPIC_API_KEY: canary, STAMP_API_KEY: "" });

    expect(config.secrets.ANTHROPIC_API_KEY).toBe("set");
    expect(config.secrets.STAMP_API_KEY).toBe("unset");
    expect(config.settings.base_url!.value).toBe("https://[redacted]@llm.internal/v1");
    expect(effectiveConfig({ provider: { base_url: "https://user:p@ss@llm.internal/v1" } }, {}).settings.base_url!.value).toBe("https://[redacted]@llm.internal/v1");

    const cli = Bun.spawnSync(["bun", "run", path.resolve(import.meta.dir, "cli.ts"), "config", "--json"], { env: { ...process.env, ANTHROPIC_API_KEY: canary, STAMP_MODEL: "openai:gpt-5.5" }, cwd: import.meta.dir });
    const out = cli.stdout.toString();

    expect(cli.exitCode).toBe(0);
    expect(out).not.toContain(canary);
    expect(JSON.parse(out)).toMatchObject({ settings: { model: { value: "openai:gpt-5.5", source: "env" } }, secrets: { ANTHROPIC_API_KEY: "set" } });
  });

  test("--help prints the usage, and a bad option gets one line and the usage, never a stack trace", () => {
    const run = (...a: string[]) => Bun.spawnSync(["bun", "run", path.resolve(import.meta.dir, "cli.ts"), ...a], { cwd: import.meta.dir });

    for (const a of [["init", "--help"], ["--help"], ["config", "-h"]]) {
      const help = run(...a);

      expect(help.exitCode).toBe(0);
      expect(help.stdout.toString()).toContain("stamp init [--model <id>]");
    }

    const bad = run("init", "--bogus");
    const err = bad.stderr.toString();

    expect(bad.exitCode).toBe(2);
    expect(err).toStartWith("stamp: Unknown option '--bogus'\nusage: stamp");
    expect(err).not.toContain("    at ");
    expect(resolve("advise_on_deny", { advise_on_deny: true }, {}).value).toBe("true");
    expect(resolve("advise_on_deny", {}, {}).value).toBe("false");
  });

  test("init writes the settings it was given into the policy, and refuses ones the policy would", () => {
    const text = policyWithSettings(bundled(), { model: "bedrock:minimax.minimax-m2.5", region: "eu-west-1" });

    expect(parseYaml(text)).toMatchObject({ model: "bedrock:minimax.minimax-m2.5", provider: { region: "eu-west-1" } });
    expect(policyWithSettings(bundled(), {})).toBe(bundled());
    expect(() => policyWithSettings(bundled(), { region: "europe" })).toThrow();
  });

  test("the published schema is PolicySchema at this version, and a bad policy names its line", () => {
    const read = (rel: string) => readFileSync(path.resolve(import.meta.dir, "..", rel), "utf8");

    expect(JSON.parse(read(".stamp/policy.schema.json"))).toEqual(JSON.parse(JSON.stringify(policyJsonSchema()))); // else: bun tools/policy-schema.ts

    for (const rel of [".stamp/policy.yml", "templates/policy-strict.yml"]) expect(read(rel)).toStartWith(`# yaml-language-server: $schema=https://unpkg.com/@jagreehal/stamp@${STAMP_VERSION}/.stamp/policy.schema.json\n`);
    expect(() => parsePolicy(bundled().replace("max_lines: ", "max_lines: -"))).toThrow(/^\.stamp\/policy\.yml:\d+:\d+ size_gate\.max_lines: /);
    expect(() => parsePolicy(bundled().replace("version: 1\n", "version: 1\nnope: true\n"))).toThrow(/^\.stamp\/policy\.yml:8:\d+ .*"nope"/);
    expect(() => parsePolicy(`${bundled()}\n  bad: [`)).toThrow(/^\.stamp\/policy\.yml:\d+:\d+ /);
    // each YAML error gets its own line, and so does an alias to a missing anchor
    expect(() => parsePolicy(bundled().replace("version: 1\n", "version: 1\nversion: 1\n").replace("allow:\n", "allow:\n  path_patterns: []\n"))).toThrow(/^\.stamp\/policy\.yml:8:1 Map keys must be unique\n\.stamp\/policy\.yml:\d+:3 Map keys must be unique$/);
    expect(() => parsePolicy(bundled().replace("version: 1\n", "version: *missing\n"))).toThrow(/^\.stamp\/policy\.yml:7:10 unresolved alias \*missing$/);
    // the schema requires deny.stamp_policy, so an editor flags its removal
    expect(policyJsonSchema()).toMatchObject({ properties: { deny: { required: ["stamp_policy"] } } });
    expect(() => parsePolicy(bundled().replace("  stamp_policy:", "  stamp_polcy:"))).toThrow(/:\d+:\d+ deny\.stamp_policy: required: the gate cannot approve edits to itself/);
  });
});
