import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { reconcilePosted, type PR } from "./github.ts";
import { notify, notifyOn, payload, type NotifyEvent } from "./notify.ts";

const EVENT: NotifyEvent = {
  event: "stamp.verdict",
  repo: "acme/api",
  pr: 7,
  url: "https://github.com/acme/api/pull/7",
  title: "Fix <!channel> login",
  head_sha: "a".repeat(40),
  verdict: "REFUSED",
  held: false,
  reason: "\nThe retry loop never ends.\nMore detail.",
};

function capture() {
  const bodies: string[] = [];

  const post = async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body));

    return new Response("ok");
  };

  return { bodies, post: Object.assign(post, { preconnect: fetch.preconnect }) };
}

describe("notify", () => {
  test("a Slack webhook gets escaped text with the first line of the reason", () => {
    const body = JSON.parse(payload("https://hooks.slack.com/services/T/B/x", EVENT));

    expect(body).toEqual({ text: "*stamp refused* <https://github.com/acme/api/pull/7|acme/api#7 Fix &lt;!channel&gt; login>\nThe retry loop never ends." });
  });

  test("a PR the gates held for a person reads as needing a person, not as a refusal", () => {
    const held = { ...EVENT, held: true, reason: "Gates denied: touches infra_cicd; T2-never. A human reviewer has to take it from here." };

    expect(JSON.parse(payload("https://hooks.slack.com/services/T/B/x", held)).text).toStartWith("*stamp needs a person* <");
    expect(JSON.parse(payload("https://example.com/hook", held))).toMatchObject({ verdict: "REFUSED", held: true });
  });

  test("any other webhook gets the event as JSON", () => {
    expect(JSON.parse(payload("https://example.com/hook", EVENT))).toEqual(EVENT);
  });

  test("approvals stay quiet by default and STAMP_NOTIFY_ON opts in", async () => {
    const { bodies, post } = capture();

    await notify("https://example.com/hook", { ...EVENT, verdict: "APPROVED" }, notifyOn(undefined), post);
    expect(bodies).toHaveLength(0);
    await notify("https://example.com/hook", { ...EVENT, verdict: "APPROVED" }, notifyOn("approved, refused, bogus"), post);
    expect(bodies).toHaveLength(1);
  });

  test("no webhook sends nothing, and a failing webhook never throws", async () => {
    const { bodies, post } = capture();

    const down = Object.assign(async () => {
      throw new Error("down");
    }, { preconnect: fetch.preconnect });

    await notify(undefined, EVENT, notifyOn(undefined), post);
    expect(bodies).toHaveLength(0);
    await notify("https://example.com/hook", EVENT, notifyOn(undefined), down);
  });
});

describe("stale verdicts", () => {
  const HEAD = "a".repeat(40);

  const BASE = "b".repeat(40);

  const pr: PR = {
    repo: "acme/api", number: 7, title: "t", body: "", author: "dev", authorAssociation: "MEMBER", isFork: false, isDraft: false,
    mergeable: "MERGEABLE", baseRef: "main", headRef: "feat", defaultBranch: "main", headSha: HEAD, baseSha: BASE, labels: [], files: [], reviews: [],
    inline: [], discussion: [], reactions: [], commits: [], diff: "",
  };

  // A fake gh that serves the live PR with the given head, no reviews, and logs every call.
  function withGh<T>(liveHead: string, run: (log: string) => T): T {
    const bin = mkdtempSync(path.join(tmpdir(), "stamp-gh-"));

    const log = path.join(bin, "calls");

    const live = JSON.stringify({ title: "t", body: "", user: { login: "dev" }, author_association: "MEMBER", draft: false, mergeable_state: "clean", labels: [], head: { sha: liveHead, repo: { full_name: "acme/api" } }, base: { ref: "main", sha: BASE, repo: { full_name: "acme/api" } } });

    writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho "$*" >> "${log}"\ncase "$*" in\n  *dismissals*) echo '{}' ;;\n  *--paginate*) echo '[[]]' ;;\n  *) echo '${live}' ;;\nesac\n`);
    chmodSync(path.join(bin, "gh"), 0o755);
    const saved = process.env.PATH;

    process.env.PATH = `${bin}:${saved}`;

    try {
      return run(log);
    } finally {
      process.env.PATH = saved;
    }
  }

  const opts = { cwd: tmpdir(), botLogin: "github-actions[bot]", started: new Date().toISOString() };

  test("an approval still on the live head is reported current", () => {
    withGh(HEAD, (log) => {
      expect(reconcilePosted(pr, 1, "APPROVED", opts)).toBe(true);
      expect(readFileSync(log, "utf8")).not.toContain("dismissals");
    });
  });

  test("an approval the head moved past is dismissed and reported stale", () => {
    withGh("c".repeat(40), (log) => {
      expect(reconcilePosted(pr, 1, "APPROVED", opts)).toBe(false);
      expect(readFileSync(log, "utf8")).toContain("reviews/1/dismissals");
    });
  });

  test("a stale comment verdict is reported stale too", () => {
    withGh("c".repeat(40), (log) => {
      expect(reconcilePosted(pr, 1, "REFUSED", opts)).toBe(false);
      expect(existsSync(log) && readFileSync(log, "utf8").includes("dismissals")).toBe(false);
    });
  });
});
