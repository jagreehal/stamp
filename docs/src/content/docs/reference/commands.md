---
title: "Command reference"
---

Run commands from a clone of the repository you want to review. Use `bunx @jagreehal/stamp` in place of `stamp` if you have not installed the CLI on `PATH`.

| Command | Purpose | Writes or cost |
| --- | --- | --- |
| `stamp init [--model <id>] [--region <aws-region>] [--strict] [--aws-oidc] [--environment <name>] [--digest] [--upgrade]` | Create policy, guidance and workflow files pinned to this stamp's version, with `--model` and `--region` written into `.stamp/policy.yml` (`--strict` writes the policy that sends auth, secrets, migrations, infrastructure, billing, public API and toolchain changes to a human), and print the secret your model needs and suggested CODEOWNERS entries; `--aws-oidc` writes the workflows with Bedrock through OIDC turned on; `--environment` runs the review job (and the digest job) in that GitHub environment, so only they can read the model key and webhook; `--digest` adds the Slack digest workflow; `--upgrade` rewrites existing workflows from this version's templates, keeping the environment, OIDC and region each was written with, and prints how many lines changed | Writes missing local files; keeps existing ones, except workflows under `--upgrade`. Never rewrites `.stamp/policy.yml` or the guidance |
| `stamp --help`, `stamp <command> --help` | Print the usage. An unknown option prints one line and the usage and exits 2 | None |
| `stamp config [--json] [--policy-dir <dir>]` | Print every effective setting with its source (env, policy or default) and each secret as set or unset, never its value. Run it first when stamp does something unexpected | Local git read only |
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
| `--policy-dir <dir>` | Read `.stamp/` files (policy, guidance, steering, rule packs) from `<dir>` first, falling back to the default branch, so you can try a policy change on a real PR before merging it. Refused with `--post`: a posted verdict is only ever judged under the default branch's policy |
| `--since <hours>` | Digest lookback; default 24 |

## Exit codes

A reviewed PR returns `0` for `APPROVED` and `1` for other verdicts. A dry run returns `0` when gates pass and `1` when they deny. A run that skips the PR (draft, or trigger label absent) or keeps an approval through retention returns `0`. Setup and successful digest commands return `0`; a usage error can return `2`. A runtime failure before a posted verdict may fail the process without producing a model verdict.

## PR comment command

A collaborator can comment `/stamp` on a PR to request a new review through the installed workflow. Enter this on GitHub, rather than in your terminal. Read [verdicts](/stamp/guides/verdicts/) for the next action after each result.
