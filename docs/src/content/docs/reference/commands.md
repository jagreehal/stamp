---
title: "Command reference"
---

Run commands from a clone of the repository you want to review. Use `bunx @jagreehal/stamp` in place of `stamp` if you have not installed the CLI on `PATH`.

| Command | Purpose | Writes or cost |
| --- | --- | --- |
| `stamp init` | Create policy, guidance and workflow files | Writes missing local files; keeps existing ones |
| `stamp rule <name>` | Copy a bundled team rule pack | Writes missing local rule file |
| `stamp <pr> --dry-run` | Run deterministic gates | GitHub reads only: no reviewer call, no Jev risk signals, no posted review |
| `stamp <pr>` | Review a PR through the selected backend | GitHub reads and model usage; no posted review |
| `stamp <pr> --post` | Review and post the verdict | GitHub review writes, approval lifecycle, model usage when gates pass, and a webhook alert when `STAMP_NOTIFY_WEBHOOK` is set |
| `stamp digest [--since <hours>]` | Send approved merges to Slack | GitHub reads and webhook write |

## Review flags

| Flag | Meaning |
| --- | --- |
| `--dry-run` | Gates only; disables posting even if `--post` is set |
| `--post` | Enable the posting and approval-withdrawal lifecycle |
| `--label <name>` | Restrict reviews to the trigger label; also configured with `STAMP_LABEL` |
| `--json <path>` | Write the scrubbed evidence bundle to a file |
| `--verbose`, `-v` | Show reviewer tool activity |
| `--since <hours>` | Digest lookback; default 24 |

## Exit codes

A reviewed PR returns `0` for `APPROVED` and `1` for other verdicts. A dry run returns `0` when gates pass and `1` when they deny. A run that skips the PR (draft, or trigger label absent) or keeps an approval through retention returns `0`. Setup and successful digest commands return `0`; a usage error can return `2`. A runtime failure before a posted verdict may fail the process without producing a model verdict.

## PR comment command

A collaborator can comment `/stamp` on a PR to request a new review through the installed workflow. Enter this on GitHub, rather than in your terminal. Read [verdicts](/stamp/guides/verdicts/) for the next action after each result.
