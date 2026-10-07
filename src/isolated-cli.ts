// Launch CLI reviewers in private process and mount namespaces with a trusted image.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, cpSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";


export const CLI_IMAGE = "stamp-reviewer:local";

export const CLI_ROOT = "/review";

export const CLI_CONTROL = "/run/stamp";

export const CLI_OUTPUT = "/output/verdict.json";

const preparedImages = new Set<string>();

/** Prepare the packaged image after Stamp has handled standing approvals and gates. */
export function prepareCliImage(image: string, env: NodeJS.ProcessEnv, context: string): void {
  if (process.env.STAMP_BUILD_CLI_IMAGE !== "1" || preparedImages.has(image)) return;

  const dockerfile = path.resolve(import.meta.dir, "../templates/reviewer.Dockerfile");
  const run = spawnSync("docker", ["build", "--file", dockerfile, "--tag", image, context], { encoding: "utf8", env, maxBuffer: 8 << 20, timeout: 10 * 60_000 });

  if (run.error || run.status !== 0) throw new Error(`CLI image preparation: ${run.error?.message ?? run.stderr.slice(0, 500)}`);

  preparedImages.add(image);
}

/** The only host:port each reviewer may reach: its model provider's API. */
export const EGRESS = { claude: ["api.anthropic.com:443"], codex: ["api.openai.com:443"] } as const;

export const EGRESS_PORT = 3128;

/**
 * The egress proxy, run with node from the reviewer image. It tunnels CONNECT to the allowed host:port pairs
 * and refuses everything else, logging each decision.
 */
export const EGRESS_PROXY = `const http = require("http"), net = require("net");
const allow = new Set((process.env.STAMP_EGRESS_ALLOW || "").split(",").filter(Boolean));
const [fromNet, fromBits] = (process.env.STAMP_EGRESS_FROM || "").split("/");
const v4 = (a) => a.split(".").reduce((n, o) => n * 256 + Number(o), 0);
const fromReview = (address) => {
  const ip = String(address).replace(/^::ffff:/, "");
  if (!fromNet || !/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(ip)) return false;
  const size = 2 ** (32 - Number(fromBits));
  return Math.floor(v4(ip) / size) === Math.floor(v4(fromNet) / size);
};
const server = http.createServer((req, res) => { res.writeHead(403); res.end("stamp egress: CONNECT only\\n"); });
server.on("connection", (socket) => { if (!fromReview(socket.remoteAddress)) { console.log("refuse " + socket.remoteAddress); socket.destroy(); } });
server.on("connect", (req, client, head) => {
  const target = String(req.url).toLowerCase();
  if (!allow.has(target)) { console.log("deny " + target); client.end("HTTP/1.1 403 Forbidden\\r\\n\\r\\n"); return; }
  console.log("allow " + target);
  const at = target.lastIndexOf(":");
  const upstream = net.connect(Number(target.slice(at + 1)), target.slice(0, at), () => {
    client.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n");
    upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
});
server.listen(Number(process.env.STAMP_EGRESS_PORT || ${3128}), "0.0.0.0", () => console.log("stamp egress ready"));`;

export type Egress = { network: string; proxyUrl: string; logs: () => string; stop: () => void };

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * A private network with no route out, and the proxy that is its one door: the proxy sits on the private
 * network and the default bridge, accepts connections only from the private network's subnet, and passes
 * only `allow`. Stopping removes both.
 */
export function startEgress(id: string, image: string, allow: readonly string[], env: NodeJS.ProcessEnv): Egress {
  const network = `stamp-net-${id}`;
  const proxy = `stamp-egress-${id}`;

  const docker = (args: string[]) => {
    const run = spawnSync("docker", args, { encoding: "utf8", env, timeout: 30_000 });

    if (run.error || run.status !== 0) throw new Error(`docker ${args[0]} failed (${run.status ?? "launch"}): ${run.error?.message ?? run.stderr.slice(0, 300)}`);

    return run.stdout;
  };

  const stop = () => {
    spawnSync("docker", ["rm", "--force", proxy], { env, stdio: "ignore", timeout: 10_000 });
    spawnSync("docker", ["network", "rm", network], { env, stdio: "ignore", timeout: 10_000 });
  };

  const logs = () => spawnSync("docker", ["logs", proxy], { encoding: "utf8", env, timeout: 10_000 }).stdout ?? "";

  try {
    // Give the reviewer an internal network whose bridge has no host IPv4 address.
    docker(["network", "create", "--internal", "--opt", "com.docker.network.bridge.inhibit_ipv4=true", network]);
    const subnet = docker(["network", "inspect", "--format", "{{(index .IPAM.Config 0).Subnet}}", network]).trim();

    if (!/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(subnet)) throw new Error(`the private network has no IPv4 subnet: ${subnet}`);
    docker(["run", "--detach", "--pull=never", "--name", proxy, "--user", "1000:1000", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
      "--pids-limit=64", "--memory=128m", "--network=bridge", "--env", `STAMP_EGRESS_ALLOW=${allow.join(",")}`, "--env", `STAMP_EGRESS_FROM=${subnet}`, "--entrypoint", "node", image, "-e", EGRESS_PROXY]);
    docker(["network", "connect", network, proxy]);

    for (let waited = 0; waited < 10_000; waited += 100) {
      if (logs().includes("stamp egress ready")) return { network, proxyUrl: `http://${proxy}:${EGRESS_PORT}`, logs, stop };
      pause(100);
    }

    throw new Error("the egress proxy did not start");
  } catch (e) {
    stop();
    throw e;
  }
}

/** No host namespace, home, socket or credential directory is exposed to the reviewer. */
export function containerArgs(name: string, image: string, repo: string, control: string, output: string, credential: string, egress?: Pick<Egress, "network" | "proxyUrl">): string[] {
  // Docker --mount uses commas as delimiters; never reinterpret a host path as extra mount options.
  if ([repo, control, output].some((p) => p.includes(","))) throw new Error("CLI isolation paths cannot contain commas");

  return ["run", "--rm", "--pull=never", "--name", name, "--interactive", "--init", "--user", "1000:1000",
    "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=256", "--memory=2g", "--cpus=2",
    // No network at all, or the private network whose only route out is the egress proxy.
    `--network=${egress?.network ?? "none"}`, "--ipc=private", "--workdir", CLI_ROOT,
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m,mode=1777",
    "--tmpfs", "/home/node:rw,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=700",
    "--mount", `type=bind,src=${repo},dst=${CLI_ROOT},readonly`,
    "--mount", `type=bind,src=${control},dst=${CLI_CONTROL},readonly`,
    "--mount", `type=bind,src=${output},dst=/output`,
    "--env", "HOME=/home/node", "--env", credential,
    ...(egress ? ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"].flatMap((k) => ["--env", `${k}=${egress.proxyUrl}`]) : []),
    "--env", "NO_PROXY=", "--env", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
    "--entrypoint", "/usr/bin/env", image];
}

/** Container output is untrusted: never follow a planted symlink into Stamp's filesystem. */
export function readCliVerdict(file: string): string {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

  try {
    const stat = fstatSync(fd);

    if (!stat.isFile() || stat.size > 1 << 20) throw new Error("CLI verdict must be a regular file under 1 MiB");

    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

export function isolatedCli(backend: "claude" | "codex", args: string[], options: { repoRoot: string; prompt: string; system: string; schema: string }) {
  // codex exec reads its key from CODEX_API_KEY; OPENAI_API_KEY is accepted as the source so existing secrets work.
  const credential = backend === "claude" ? "CLAUDE_CODE_OAUTH_TOKEN" : "CODEX_API_KEY";
  const sources = backend === "claude" ? ["CLAUDE_CODE_OAUTH_TOKEN"] : ["CODEX_API_KEY", "OPENAI_API_KEY"];
  const secret = sources.map((k) => process.env[k]).find(Boolean);

  if (!secret) throw new Error(`${backend} isolation requires ${sources.join(" or ")}; host login directories are never mounted`);

  const dir = mkdtempSync(path.join(tmpdir(), "stamp-cli-"));
  const id = randomUUID();
  const name = `stamp-${id}`;
  const image = process.env.STAMP_CLI_IMAGE || CLI_IMAGE;
  const repo = path.join(dir, "repo");
  const control = path.join(dir, "control");
  const output = path.join(dir, "output");
  // Docker needs runtime configuration on the client, but only the named --env value enters the container.
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v && /^(PATH|HOME|DOCKER_[A-Z_]+)$/.test(k))), [credential]: secret };

  let egress: Egress | null = null;

  try {
    const context = path.join(dir, "context");
    mkdirSync(context);
    prepareCliImage(image, env, context);
    cpSync(options.repoRoot, repo, { recursive: true, dereference: false, filter: (p) => path.basename(p) !== ".git" });
    mkdirSync(control);
    mkdirSync(output);
    chmodSync(dir, 0o755);
    chmodSync(output, 0o777);
    writeFileSync(path.join(control, "schema.json"), options.schema);
    writeFileSync(path.join(control, "instructions.md"), options.system);

    egress = startEgress(id, image, EGRESS[backend], env);

    const run = spawnSync("docker", [...containerArgs(name, image, repo, control, output, credential, egress), "timeout", "--signal=KILL", "900", backend, ...args], {
      input: options.prompt, encoding: "utf8", env, maxBuffer: 64 << 20, timeout: 15 * 60_000,
    });

    if (run.error || run.status !== 0) throw new Error(`${backend} isolated review failed (${run.status ?? "launch"}); Docker and a trusted STAMP_CLI_IMAGE are required. ${run.error?.message ?? run.stderr.slice(0, 500)}`);

    return { stdout: run.stdout, verdict: backend === "codex" ? readCliVerdict(path.join(output, "verdict.json")) : null };
  } finally {
    // Killing the client on timeout does not necessarily stop its container.
    spawnSync("docker", ["rm", "--force", name], { env, stdio: "ignore", timeout: 10_000 });
    egress?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}
