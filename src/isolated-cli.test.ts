import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";
import { z } from "zod";
import { CLI_IMAGE, containerArgs, EGRESS, EGRESS_PROXY, isolatedCli, readCliVerdict, startEgress } from "./isolated-cli.ts";

/** A minimal TLS 1.2-framed ClientHello carrying one server_name, split into records of at most `recordSize` bytes. */
function clientHello(name: string, recordSize = 16384): Buffer {
  const host = Buffer.from(name);
  const u16 = (n: number) => Buffer.from([n >> 8, n & 255]);
  const serverName = Buffer.concat([u16(0), u16(host.length + 5), u16(host.length + 3), Buffer.from([0]), u16(host.length), host]);
  const body = Buffer.concat([u16(0x0303), Buffer.alloc(32), Buffer.from([0]), u16(2), u16(0x1301), Buffer.from([1, 0]), u16(serverName.length), serverName]);
  const handshake = Buffer.concat([Buffer.from([1, 0]), u16(body.length), body]);

  const records: Buffer[] = [];

  for (let at = 0; at < handshake.length; at += recordSize) {
    const fragment = handshake.subarray(at, at + recordSize);

    records.push(Buffer.from([22, 3, 1]), u16(fragment.length), fragment);
  }

  return Buffer.concat(records);
}

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
      if(args[0]==='build'){
        const context=args.at(-1); const dockerfile=args[args.indexOf('--file')+1];
        fs.writeFileSync(${JSON.stringify(log)}+'.build',JSON.stringify({context,dockerfile,files:fs.readdirSync(context)}));process.exit(0)
      }
      if(args[0]==='network'&&args[1]==='inspect'){console.log('172.30.0.0/16');process.exit(0)}
      if(args[0]==='rm'||args[0]==='network') process.exit(0);
      if(args[0]==='logs'){console.log('stamp egress ready');process.exit(0)}
      if(args.includes('--detach')){fs.writeFileSync(${JSON.stringify(log)}+'.proxy',JSON.stringify(args));process.exit(0)}
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
    delete process.env.CODEX_API_KEY;
    process.env.STAMP_BUILD_CLI_IMAGE = "1";
    process.env.STAMP_CLI_IMAGE = `stamp-test-image-${Date.now()}`;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "claude-only";

    try {
      for (const backend of ["codex", "claude"] as const) {
        const run = isolatedCli(backend, [], { repoRoot: repo, prompt: "p", system: "s", schema: "{}" });
        const recorded = JSON.parse(readFileSync(log, "utf8"));

        const build = JSON.parse(readFileSync(log + ".build", "utf8"));

        expect(build.files).toEqual([]);
        expect(build.dockerfile).toBe(path.resolve(import.meta.dir, "../templates/reviewer.Dockerfile"));
        expect(recorded.hasGit).toBe(false);
        expect(recorded.env.GH_TOKEN).toBeUndefined();
        expect(recorded.env.ANTHROPIC_API_KEY).toBeUndefined();
        expect(recorded.env.OPENAI_API_KEY).toBeUndefined();
        expect(recorded.env.CODEX_API_KEY).toBe(backend === "codex" ? "codex-only" : undefined);
        expect(recorded.args.find((a: string) => a.startsWith("--network="))).toMatch(/^--network=stamp-net-/);
        expect(recorded.args).toContain("HTTPS_PROXY=" + recorded.args.find((a: string) => a.startsWith("HTTPS_PROXY="))?.slice("HTTPS_PROXY=".length));
        expect(JSON.parse(readFileSync(log + ".proxy", "utf8"))).toContain(`STAMP_EGRESS_ALLOW=${EGRESS[backend].join(",")}`);
        expect(recorded.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(backend === "claude" ? "claude-only" : undefined);
        expect(() => readFileSync(path.join(recorded.repo, "code.ts"))).toThrow();
        expect(backend === "codex" ? run.verdict : run.stdout).toContain(backend === "codex" ? "REFUSE" : "success");
      }

      writeFileSync(path.join(bin, "docker"), '#!/bin/sh\nexit 125\n');
      expect(() => isolatedCli("codex", [], { repoRoot: repo, prompt: "p", system: "s", schema: "{}" })).toThrow(/failed \(125\)/);
      process.env.STAMP_CLI_IMAGE = `stamp-test-build-${Date.now()}`;
      expect(() => isolatedCli("codex", [], { repoRoot: repo, prompt: "p", system: "s", schema: "{}" })).toThrow("CLI image preparation");
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in envBefore)) delete process.env[k];
      Object.assign(process.env, envBefore);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the egress proxy tunnels only the allowed host:port, and only when TLS names that host", async () => {
    // The upstream answers once it has the client's first bytes, so a tunnel that reaches it proves the hello passed.
    const upstream = createServer((socket) => socket.once("data", (d) => socket.end(`upstream reached ${d[0]}`)));

    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const { port: upstreamPort } = z.object({ port: z.number() }).parse(upstream.address());
    const allowed = `127.0.0.1:${upstreamPort}`;
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const proxy = spawn("node", ["-e", EGRESS_PROXY], { env: { ...process.env, STAMP_EGRESS_ALLOW: allowed, STAMP_EGRESS_PORT: String(port), STAMP_EGRESS_FROM: "127.0.0.0/8" } });
    let logs = "";

    proxy.stdout.on("data", (d) => (logs += d));
    await new Promise<void>((resolve) => proxy.stdout.on("data", () => logs.includes("ready") && resolve()));

    const tunnel = (target: string, ...writes: Buffer[]) =>
      new Promise<{ status: number; body: string }>((resolve) => {
        const req = request({ host: "127.0.0.1", port, method: "CONNECT", path: target });

        req.on("connect", (res, socket, head) => {
          // Bytes that arrive with the 200 come in `head`, not as socket data.
          let body = head.toString();

          socket.on("data", (d) => (body += d));
          socket.on("close", () => resolve({ status: res.statusCode ?? 0, body }));
          socket.on("error", () => {});
          writes.forEach((w, i) => setTimeout(() => socket.write(w), i * 20));
        });
        req.end();
      });

    const hello = clientHello("127.0.0.1");

    try {
      expect(await tunnel(allowed, hello)).toEqual({ status: 200, body: "upstream reached 22" });
      expect(await tunnel(allowed, hello.subarray(0, 20), hello.subarray(20))).toEqual({ status: 200, body: "upstream reached 22" });
      // TLS may split one ClientHello across records; 3 bytes puts even the handshake header in two records.
      expect(await tunnel(allowed, clientHello("127.0.0.1", 3))).toEqual({ status: 200, body: "upstream reached 22" });
      expect(await tunnel(allowed, clientHello("127.0.0.1", 40))).toEqual({ status: 200, body: "upstream reached 22" });
      expect(await tunnel(allowed, clientHello("discord.com", 40))).toEqual({ status: 200, body: "" });
      expect(await tunnel(allowed, clientHello("discord.com"))).toEqual({ status: 200, body: "" });
      expect(await tunnel(allowed, Buffer.from("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"))).toEqual({ status: 200, body: "" });
      expect((await tunnel("example.com:443")).status).toBe(403);
      expect((await tunnel(allowed.replace(/:\d+$/, ":1"))).status).toBe(403);
      expect(logs).toContain(`deny ${allowed} sni discord.com`);
      expect(logs).toContain(`deny ${allowed} sni null`);
    } finally {
      proxy.kill();
    }

    // A client outside the review's subnet is refused before it can ask for anything.
    const strictPort = port + 1;
    const strict = spawn("node", ["-e", EGRESS_PROXY], { env: { ...process.env, STAMP_EGRESS_ALLOW: allowed, STAMP_EGRESS_PORT: String(strictPort), STAMP_EGRESS_FROM: "10.99.0.0/16" } });

    await new Promise<void>((resolve) => strict.stdout.on("data", (d) => String(d).includes("ready") && resolve()));

    try {
      const refused = await new Promise<string>((resolve) => {
        const req = request({ host: "127.0.0.1", port: strictPort, method: "CONNECT", path: allowed });

        req.on("connect", () => resolve("tunnelled"));
        req.on("error", (e) => resolve(z.object({ code: z.string() }).parse(e).code));
        req.end();
      });

      expect(refused).toBe("ECONNRESET");
    } finally {
      strict.kill();
      upstream.close();
    }
  });

  // Real Linux boundary test, without model credentials or paid calls. CI must explicitly enable it.
  test.skipIf(process.env.STAMP_ISOLATION_TEST !== "1")("Linux container reaches only its provider, through the proxy", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stamp-egress-"));
    const image = process.env.STAMP_CLI_IMAGE || CLI_IMAGE;
    const egress = startEgress(`probe-${Date.now()}`, image, EGRESS.codex, process.env);

    try {
      for (const sub of ["repo", "control", "output"]) mkdirSync(path.join(dir, sub), { mode: 0o777 });

      // fronted: TLS to the provider's address naming another site on the same CDN, which the proxy must refuse.
      const script = `const http=require("http"), tls=require("tls"), proxy=new URL(process.env.HTTPS_PROXY);
        const connect=t=>new Promise(r=>{const q=http.request({host:proxy.hostname,port:proxy.port,method:"CONNECT",path:t});q.on("connect",res=>{r(res.statusCode);res.socket?.destroy()});q.on("error",e=>r(e.code));q.end()});
        const handshake=(t,servername)=>new Promise(r=>{const q=http.request({host:proxy.hostname,port:proxy.port,method:"CONNECT",path:t});
          q.on("connect",(res,socket)=>{const s=tls.connect({socket,servername});s.on("secureConnect",()=>{r("tls");s.destroy()});s.on("error",()=>r("refused"));s.on("close",()=>r("refused"))});q.on("error",e=>r(e.code));q.end()});
        (async()=>{
          const direct=await fetch("https://example.com").then(()=>"open",()=>"blocked");
          console.log(JSON.stringify({direct, other:await connect("example.com:443"), provider:await handshake("api.openai.com:443","api.openai.com"), fronted:await handshake("api.openai.com:443","discord.com")}));
        })()`;

      const args = containerArgs(`stamp-egress-run-${Date.now()}`, image, path.join(dir, "repo"), path.join(dir, "control"), path.join(dir, "output"), "STAMP_UNUSED", egress);
      const result = JSON.parse(execFileSync("docker", [...args, "node", "-e", script], { encoding: "utf8", timeout: 60_000 }).trim());

      expect(result).toEqual({ direct: "blocked", other: 403, provider: "tls", fronted: "refused" });

      // The host takes no address on the private network, so a review cannot reach a host service through it.
      const subnet = execFileSync("docker", ["network", "inspect", "--format", "{{(index .IPAM.Config 0).Subnet}}", egress.network], { encoding: "utf8" }).trim();
      const prefix = subnet.split("/")[0]!.split(".").slice(0, 3).join(".") + ".";
      const hostAddresses = execFileSync("docker", ["run", "--rm", "--network=host", image, "node", "-e", "console.log(Object.values(require('os').networkInterfaces()).flat().map(i=>i.address).join(' '))"], { encoding: "utf8", timeout: 30_000 });

      expect(hostAddresses.split(/\s+/).filter((a) => a.startsWith(prefix))).toEqual([]);
      expect(egress.logs()).toContain("deny example.com:443");
      expect(egress.logs()).toContain("deny api.openai.com:443 sni discord.com");
      expect(egress.logs()).not.toContain("refuse");
    } finally {
      egress.stop();
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
