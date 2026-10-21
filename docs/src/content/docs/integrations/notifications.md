---
title: "Send notifications and a Slack digest"
---

Choose immediate verdict alerts, a digest of approved merges, or both.

## Verdict alerts

Add `STAMP_NOTIFY_WEBHOOK` as a repository Actions secret. Stamp posts to it the moment a verdict lands on the PR. The generated workflow passes it through; a custom workflow must pass it in the review step's `env`.

Set the `STAMP_NOTIFY_ON` repository variable to a comma-separated list of verdicts. The default is `REFUSED,ESCALATE,ERROR`. Add `APPROVED` to hear about every verdict, for example `APPROVED,REFUSED,ESCALATE,ERROR`. Stamp ignores names it does not know, and a list with no known verdict falls back to the default. A PR the gates hold for a person counts as `REFUSED` here; its alert reads "needs a person" and its JSON carries `"held": true`.

A Slack Incoming Webhook URL (`https://hooks.slack.com/services/...`) receives a Slack message: the verdict, a link to the PR with its title, and the first line of the reason, cut to 300 characters. Stamp escapes `&`, `<` and `>` in the title and reason, since both are PR-authored and Slack would otherwise read `<!channel>` as a mention.

Any other URL receives the `stamp.verdict` event as JSON. `held` is `true` when the gates held the PR for a person before any review, so a receiver can route it apart from a review that found a problem. Stamp scrubs credentials from the reason and cuts it to 2,000 characters. Use a relay if your service needs a different payload.

```json
{
  "event": "stamp.verdict",
  "repo": "acme/api",
  "pr": 42,
  "url": "https://github.com/acme/api/pull/42",
  "title": "Fix login",
  "head_sha": "reviewed-commit-sha",
  "verdict": "REFUSED",
  "held": false,
  "reason": "The retry loop has no exit condition."
}
```

When Stamp does not notify:

- Only a `--post` run notifies. A dry run or a local run without `--post` sends nothing.
- A verdict that went stale while posting (a newer push, a retarget, or a later run's verdict on the same head) notifies nobody. The newer run sends its own.
- A run that keeps an approval through [approval retention](/stamp/operations/approval-retention/), or skips the PR (draft, trigger label absent), posts no verdict and sends nothing.

A failing webhook never changes a verdict. Stamp waits up to 10 seconds, then logs `notify webhook returned <status>` or `notify webhook failed: <reason>` and carries on.

Requests carry no signature. For Slack the webhook URL is the secret: anyone holding it can post to the channel, so keep it in Actions secrets and rotate it if it leaks. A receiver that only displays alerts needs nothing more. A receiver that acts on events, such as starting a job, should verify the sender with a request signature, which Stamp does not send yet; until it does, check the PR and head SHA against GitHub before acting.

Inspect the PR review after you receive an alert; the event names the reviewed commit. Answer on GitHub with a fix or a `/stamp` comment.

## Approved-merge digest

`stamp init --digest` writes `stamp-digest.yml`. Add `STAMP_SLACK_WEBHOOK` (a Slack Incoming Webhook URL) as a repository secret; without it the scheduled run logs that the digest is off and exits. The workflow runs on weekdays at 14:00 UTC and includes the last 24 hours of approved merges, or 72 hours on Monday. You can also start it by hand from the Actions tab. Each line links a merged PR that Stamp approved, with the reviewer's change summary.

To run a digest from your terminal, set the webhook in your environment and run:

```bash
bunx @jagreehal/stamp digest --since 48
```

The `--since` value is a lookback in hours. Keep webhook URLs out of source control. Read [environment and credentials](/stamp/reference/environment/) for the settings.
