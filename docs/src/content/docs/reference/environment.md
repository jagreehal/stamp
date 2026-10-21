---
title: "Environment and credentials"
---

Set non-secret CI settings as repository Actions variables and credentials as Actions secrets. In your terminal, export the same names in the process environment. The generated workflow passes supported values into Stamp; adding a secret alone does not pass it to a custom workflow.

Keep settings such as `STAMP_MODEL`, `STAMP_BACKEND`, `STAMP_BACKENDS` and `STAMP_NOTIFY_ON` out of secrets. GitHub masks a secret's value everywhere in the run log, so a secret `STAMP_BACKEND=api` would replace every "api" in the log with `***`. The generated workflow reads these settings from `vars`.

Every setting below is also a key in `.stamp/policy.yml`, which is where it belongs: see the [settings table](/stamp/reference/configuration/#settings). A non-blank variable overrides the policy. Run `stamp config` to see which one won.

## Review settings

| Name | Default | Purpose |
| --- | --- | --- |
| `STAMP_BACKEND` | `api` | `api`, `claude`, or `codex` review backend |
| `STAMP_BACKENDS` | Unset | Comma-separated backends for primary and independent second opinion; overrides the single backend selection and the policy's `backends` |
| `STAMP_MODEL` | The policy's `model`, else `claude-opus-5` | API backend's `provider:model` ID, or a tier name from shepherd's config on the default branch; see the backend table. Prefer `model` in `.stamp/policy.yml`, which is reviewed |
| `STAMP_CLAUDE_MODEL` | CLI default | Model for the Claude CLI backend |
| `STAMP_CODEX_MODEL` | CLI default | Model for the Codex CLI backend |
| `STAMP_LABEL` | Unset | Review only PRs carrying this label; unset reviews every PR |
| `STAMP_BOT_LOGIN` | `gh`'s login, else `github-actions[bot]` | Identify Stamp's reviews; generated workflow uses `github-actions[bot]` |
| `STAMP_GUARD` | `budget:$2,tokens:3m,loop:4/12,max-tools:80,timeout:15m` | API review resource limits |
| `STAMP_PRICING` | Unset | JSON prices per million input/output tokens for unpriced models; adds to and overrides the policy's `pricing`. A run on a model with no price logs `budget guard inactive` |
| `STAMP_MAX_OUTPUT_TOKENS` | `16000`, or `10000` on Amazon Nova | Output-token ceiling for each model call; lower it for a model with a smaller limit |
| `STAMP_CLI_IMAGE` | `stamp-reviewer:local` | Docker image for CLI review |
| `STAMP_BUILD_CLI_IMAGE` | Unset | `1` prepares the packaged image inside the review path; generated workflow sets it |
| `ANTHROPIC_BASE_URL` | Provider default | Alternate Anthropic-compatible API endpoint |

Use [backends and providers](/stamp/reference/backends/) for model syntax, the concrete default model, CLI image requirements and second-opinion behaviour. API guard limits do not replace the separate CLI backend limits.

## Credentials

| Name | Used for |
| --- | --- |
| `GH_TOKEN` / `GITHUB_TOKEN` | GitHub API and authenticated Git reads; the workflow supplies a GitHub token |
| `STAMP_API_KEY` | API backend: the key for whichever provider `STAMP_MODEL` names; takes precedence over the provider variables below. On Bedrock it is a Bedrock API key |
| `ANTHROPIC_API_KEY` | Anthropic API backend |
| `STAMP_BASE_URL` | The OpenAI-compatible base URL for a `compatible:` model (`https://host/v1`); not a secret |
| `CLAUDE_CODE_OAUTH_TOKEN` | Isolated Claude CLI backend |
| `CODEX_API_KEY` / `OPENAI_API_KEY` | Isolated Codex CLI backend; `OPENAI_API_KEY` is also the key for an `openai:` model |
| `OPENCODE_API_KEY` | OpenCode Go or Zen API provider |
| `OPENROUTER_API_KEY` | OpenRouter API provider |
| `GROQ_API_KEY` | Groq API provider |
| `MISTRAL_API_KEY` | Mistral API provider |
| `DEEPSEEK_API_KEY` | DeepSeek API provider |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway provider |
| `AWS_BEARER_TOKEN_BEDROCK` | Bedrock API key, when `STAMP_API_KEY` is unset |
| `AWS_REGION` | Bedrock region; not a secret |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | AWS credential chain when used instead of bearer auth; profiles, roles and OIDC can provide credentials too |
| `TYPESAFE_API_KEY` | Optional Jev risk signals |

Provide the credentials for the backend you selected. For the API backend, `STAMP_API_KEY` alone is enough on any provider, Bedrock included; the provider variables are fallbacks. Bedrock with no key signs with AWS credentials, which is how OIDC works. The CLI isolation layer passes only the selected backend's credential into the reviewer container. Private rule packs may require a GitHub identity with read access to the policy repository.

## Notifications and telemetry

| Name | Purpose |
| --- | --- |
| `STAMP_NOTIFY_WEBHOOK` | Secret: immediate verdict alerts; a Slack Incoming Webhook URL or any URL that takes JSON |
| `STAMP_NOTIFY_ON` | Variable: comma-separated verdicts; default `REFUSED,ESCALATE,ERROR`; add `APPROVED` for every verdict |
| `STAMP_SLACK_WEBHOOK` | Secret: approved-merge digest |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Variable: enable review trace export to your collector |
| `OTEL_EXPORTER_OTLP_HEADERS` | Secret collector headers |
| `OTEL_SERVICE_NAME` | Trace service name; default `stamp` |

The Actions runner supplies `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_EVENT_NAME` and `GITHUB_SERVER_URL` as run context. Do not configure the internal `STAMP_EGRESS_ALLOW`, `STAMP_EGRESS_FROM` or `STAMP_EGRESS_PORT` values as user policy; the isolation implementation uses them inside its egress proxy.

See [notifications](/stamp/integrations/notifications/) and the limits-and-traces section of [backends](/stamp/reference/backends/#limits-cost-and-traces).
