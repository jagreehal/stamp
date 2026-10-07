// CLI reviewers never run in Stamp's process or mount namespace. The Docker daemon and image are trusted.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, cpSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";


export const CLI_IMAGE = "stamp-reviewer:local";

export const CLI_ROOT = "/review";

export const CLI_CONTROL = "/run/stamp";

export const CLI_OUTPUT = "/output/verdict.json";

/** No host namespace, home, socket or credential directory is exposed to the reviewer. */
export function containerArgs(name: string, image: string, repo: string, control: string, output: string, credential: string): string[] {
  // Docker --mount uses commas as delimiters; never reinterpret a host path as extra mount options.
  if ([repo, control, output].some((p) => p.includes(","))) throw new Error("CLI isolation paths cannot contain commas");

  return ["run", "--rm", "--pull=never", "--name", name, "--interactive", "--init", "--user", "1000:1000",
    "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=256", "--memory=2g", "--cpus=2",
    "--network=bridge", "--ipc=private", "--workdir", CLI_ROOT,
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m,mode=1777",
    "--tmpfs", "/home/node:rw,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=700",
    "--mount", `type=bind,src=${repo},dst=${CLI_ROOT},readonly`,
    "--mount", `type=bind,src=${control},dst=${CLI_CONTROL},readonly`,
    "--mount", `type=bind,src=${output},dst=/output`,
    "--env", "HOME=/home/node", "--env", credential, "--entrypoint", "/usr/bin/env", image];
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
  const credential = backend === "claude" ? "CLAUDE_CODE_OAUTH_TOKEN" : "OPENAI_API_KEY";

  if (!process.env[credential]) throw new Error(`${backend} isolation requires ${credential}; host login directories are never mounted`);

  const dir = mkdtempSync(path.join(tmpdir(), "stamp-cli-"));
  const name = `stamp-${randomUUID()}`;
  const repo = path.join(dir, "repo");
  const control = path.join(dir, "control");
  const output = path.join(dir, "output");
  // Docker needs runtime configuration on the client, but only the named --env value enters the container.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v && (k === credential || /^(PATH|HOME|DOCKER_[A-Z_]+)$/.test(k))));

  try {
    cpSync(options.repoRoot, repo, { recursive: true, dereference: false, filter: (p) => path.basename(p) !== ".git" });
    mkdirSync(control);
    mkdirSync(output);
    chmodSync(dir, 0o755);
    chmodSync(output, 0o777);
    writeFileSync(path.join(control, "schema.json"), options.schema);
    writeFileSync(path.join(control, "instructions.md"), options.system);

    const run = spawnSync("docker", [...containerArgs(name, process.env.STAMP_CLI_IMAGE || CLI_IMAGE, repo, control, output, credential), "timeout", "--signal=KILL", "900", backend, ...args], {
      input: options.prompt, encoding: "utf8", env, maxBuffer: 64 << 20, timeout: 15 * 60_000,
    });

    if (run.error || run.status !== 0) throw new Error(`${backend} isolated review failed (${run.status ?? "launch"}); Docker and a trusted STAMP_CLI_IMAGE are required. ${run.error?.message ?? run.stderr.slice(0, 500)}`);

    return { stdout: run.stdout, verdict: backend === "codex" ? readCliVerdict(path.join(output, "verdict.json")) : null };
  } finally {
    // Killing the client on timeout does not necessarily stop its container.
    spawnSync("docker", ["rm", "--force", name], { env, stdio: "ignore", timeout: 10_000 });
    rmSync(dir, { recursive: true, force: true });
  }
}
