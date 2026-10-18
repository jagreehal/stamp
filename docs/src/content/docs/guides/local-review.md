---
title: "Review a PR from your terminal"
---

```bash
# run from inside the repository you want reviewed
bunx @jagreehal/stamp 42

# dry run (gates only, no LLM calls)
bunx @jagreehal/stamp 42 --dry-run

# post the verdict to GitHub
bunx @jagreehal/stamp 42 --post

# save the full result as JSON, show tool calls
bunx @jagreehal/stamp 42 --json /tmp/review.json -v

# post the Slack digest of stamp-approved merges from the last 48 hours
STAMP_SLACK_WEBHOOK=https://hooks.slack.com/... bunx @jagreehal/stamp digest --since 48
```

You need [bun](https://bun.sh) and an authenticated `gh` CLI.

The exit code is 0 on APPROVED and 1 on every other verdict. A dry run exits 0 when the gates pass and 1 when they deny. `--dry-run` turns `--post` off. Only a `--post` run sends [verdict alerts](/stamp/integrations/notifications/).
