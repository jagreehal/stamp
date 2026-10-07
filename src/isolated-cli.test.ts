import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CLI_IMAGE, containerArgs, isolatedCli, readCliVerdict } from "./isolated-cli.ts";

describe("CLI isolation", () => {
  test("launcher cannot share host processes, writable checkout, home or sockets", () => {
    const args = containerArgs("probe", CLI_IMAGE, "/repo", "/control", "/output", "OPENAI_API_KEY");

    expect(args).toContain("--read-only");
    expect(args).toContain("--cap-drop=ALL");
    expect(args).toContain("--security-opt=no-new-privileges");
    expect(args).toContain("1000:1000");
    expect(args).toContain("type=bind,src=/repo,dst=/review,readonly");
    expect(args.filter((a) => a.startsWith("type=bind"))).toHaveLength(3);
    expect(args).not.toContain("--pid=host");
    expect(args).not.toContain("--privileged");
    expect(args).not.toContain("GH_TOKEN");
    expect(() => containerArgs("p", CLI_IMAGE, "/repo,extra", "/c", "/o", "OPENAI_API_KEY")).toThrow();
  });

  test("a planted output symlink never causes Stamp to read a host secret", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stamp-output-"));

    try {
      writeFileSync(path.join(dir, "secret"), "host-secret");
      symlinkSync(path.join(dir, "secret"), path.join(dir, "verdict.json"));
      expect(() => readCliVerdict(path.join(dir, "verdict.json"))).toThrow();
      writeFileSync(path.join(dir, "regular.json"), '{"verdict":"REFUSE"}');
      expect(readCliVerdict(path.join(dir, "regular.json"))).toContain("REFUSE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no host subscription login fallback when a container credential is absent", () => {
    const saved = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    try {
      expect(() => isolatedCli("claude", [], { repoRoot: ".", prompt: "p", system: "s", schema: "{}" })).toThrow("host login directories are never mounted");
    } finally {
      if (saved !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = saved;
    }
  });

  test("both backends launch only Docker with their own key, omit .git, and clean up", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stamp-launch-"));
    const envBefore = { ...process.env };
    const bin = path.join(dir, "bin");
    const repo = path.join(dir, "repo");
    const log = path.join(dir, "log.json");

    mkdirSync(bin);
    mkdirSync(repo);
    mkdirSync(path.join(repo, ".git"));
    writeFileSync(path.join(repo, ".git", "config"), "host-git-token");
    writeFileSync(path.join(repo, "code.ts"), "original");

    const fake = `#!/usr/bin/env node
      const fs=require('fs');const args=process.argv.slice(2);
      if(args[0]==='rm') process.exit(0);
      const mounts=args.filter(a=>a.startsWith('type=bind'));
      const src=target=>mounts.find(a=>a.includes('dst='+target)).match(/src=([^,]+)/)[1];
      fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({args,env:process.env,repo:src('/review'),hasGit:fs.existsSync(src('/review')+'/.git')}));
      if(args.includes('codex'))fs.writeFileSync(src('/output')+'/verdict.json','{"verdict":"REFUSE"}');
      else console.log('{"is_error":false,"subtype":"success"}');`;

    writeFileSync(path.join(bin, "docker"), fake);
    chmodSync(path.join(bin, "docker"), 0o755);
    process.env.PATH = `${bin}:${process.env.PATH}`;
    process.env.GH_TOKEN = "stamp-github-canary";
    process.env.ANTHROPIC_API_KEY = "stamp-provider-canary";
    process.env.OPENAI_API_KEY = "codex-only";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "claude-only";

    try {
      for (const backend of ["codex", "claude"] as const) {
        const run = isolatedCli(backend, [], { repoRoot: repo, prompt: "p", system: "s", schema: "{}" });
        const recorded = JSON.parse(readFileSync(log, "utf8"));

        expect(recorded.hasGit).toBe(false);
        expect(recorded.env.GH_TOKEN).toBeUndefined();
        expect(recorded.env.ANTHROPIC_API_KEY).toBeUndefined();
        expect(recorded.env.OPENAI_API_KEY).toBe(backend === "codex" ? "codex-only" : undefined);
        expect(recorded.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(backend === "claude" ? "claude-only" : undefined);
        expect(() => readFileSync(path.join(recorded.repo, "code.ts"))).toThrow();
        expect(backend === "codex" ? run.verdict : run.stdout).toContain(backend === "codex" ? "REFUSE" : "success");
      }

      writeFileSync(path.join(bin, "docker"), '#!/bin/sh\nexit 125\n');
      expect(() => isolatedCli("codex", [], { repoRoot: repo, prompt: "p", system: "s", schema: "{}" })).toThrow("isolated review failed (125)");
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in envBefore)) delete process.env[k];
      Object.assign(process.env, envBefore);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Real Linux boundary test, without model credentials or paid calls. CI must explicitly enable it.
  test.skipIf(process.env.STAMP_ISOLATION_TEST !== "1")("Linux container cannot read host process secrets or mutate the checkout", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stamp-proc-"));
    const marker = `stamp-host-secret-${Date.now()}`;

    try {
      for (const sub of ["repo", "control", "output"]) mkdirSync(path.join(dir, sub), { mode: 0o777 });
      writeFileSync(path.join(dir, "repo", "code.ts"), "original");
      symlinkSync("/proc/1/root/etc/shadow", path.join(dir, "repo", "escape"));

      const script = `const fs=require('fs'); const fail=m=>{throw Error(m)};
        for(const pid of fs.readdirSync('/proc').filter(p=>/^\\d+$/.test(p))) {
          try { if(fs.readFileSync('/proc/'+pid+'/environ').includes(${JSON.stringify(marker)})) fail('host env leaked'); }
          catch(e) { if(e.message==='host env leaked') throw e; }
        }
        if(fs.existsSync('/var/run/docker.sock')) fail('docker socket exposed');
        for(const p of ['/review/code.ts','/review/escape','/etc/stamp-probe']) {
          let denied=false; try {fs.writeFileSync(p,'changed')} catch {denied=true}
          if(!denied) fail('write allowed: '+p);
        }
        let denied=false; try {fs.readFileSync('/review/escape')} catch {denied=true}
        if(!denied) fail('host/root file accessible');
        console.log('isolation passed');`;

      const args = containerArgs(`stamp-probe-${Date.now()}`, process.env.STAMP_CLI_IMAGE || CLI_IMAGE, path.join(dir, "repo"), path.join(dir, "control"), path.join(dir, "output"), "STAMP_UNUSED");
      const result = execFileSync("docker", [...args, "node", "-e", script], { encoding: "utf8", timeout: 30_000, env: { ...process.env, STAMP_HOST_CANARY: marker } });

      expect(result).toContain("isolation passed");
      expect(readFileSync(path.join(dir, "repo", "code.ts"), "utf8")).toBe("original");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
