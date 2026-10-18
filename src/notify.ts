// Outbound notifications. Off until STAMP_NOTIFY_WEBHOOK is set. A Slack Incoming Webhook URL gets a
// Slack message; any other URL gets the event as JSON, so Discord relays, Teams, n8n, Zapier or an
// agent platform's trigger can take it from there. People answer on the PR, where stamp re-reviews.
import type { Verdict } from "./github.ts";

export type NotifyEvent = {
  event: "stamp.verdict";
  repo: string;
  pr: number;
  url: string;
  title: string;
  head_sha: string;
  verdict: Verdict;
  /** True when the gates held the PR for a person before any review: nothing to fix, someone has to look. */
  held: boolean;
  reason: string;
};

/** Verdicts that notify unless STAMP_NOTIFY_ON says otherwise. Approvals land in the digest. */
export const NOTIFY_DEFAULT: Verdict[] = ["REFUSED", "ESCALATE", "ERROR"];

const VERDICTS: Verdict[] = ["APPROVED", "REFUSED", "ESCALATE", "ERROR"];

export function notifyOn(raw: string | undefined): Verdict[] {
  const asked = new Set((raw ?? "").split(",").map((s) => s.trim().toUpperCase()));
  const list = VERDICTS.filter((v) => asked.has(v));

  return list.length ? list : NOTIFY_DEFAULT;
}

// PR titles and model reasoning are untrusted; Slack reads <...> as links and mentions (<!channel>).
export const slackEscape = (t: string) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const isSlack = (url: string) => url.startsWith("https://hooks.slack.com/services/");

export function slackText(e: NotifyEvent): string {
  const reason = e.reason.split("\n").find((l) => l.trim()) ?? "";

  return `*stamp ${e.held ? "needs a person" : e.verdict.toLowerCase()}* <${e.url}|${e.repo}#${e.pr} ${slackEscape(e.title)}>\n${slackEscape(reason.slice(0, 300))}`;
}

export function payload(url: string, e: NotifyEvent): string {
  return JSON.stringify(isSlack(url) ? { text: slackText(e) } : { ...e, reason: e.reason.slice(0, 2000) });
}

/** Posts the event. Never throws: a notification must not change a verdict. */
export async function notify(url: string | undefined, e: NotifyEvent, on: Verdict[], post: typeof fetch = fetch): Promise<void> {
  if (!url || !on.includes(e.verdict)) return;

  try {
    const res = await post(url, { method: "POST", headers: { "content-type": "application/json" }, body: payload(url, e), signal: AbortSignal.timeout(10_000) });

    if (!res.ok) console.error(`notify webhook returned ${res.status}`);
  } catch (err) {
    console.error(`notify webhook failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
