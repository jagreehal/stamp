---
"@jagreehal/stamp": minor
---

Review with any model on any provider, with limits and a run record on every review.

- `STAMP_MODEL=provider:model` runs the `api` backend through the AI SDK on Amazon Bedrock, OpenCode Go and Zen, OpenRouter, Vercel AI Gateway, or Anthropic. A bare id stays Anthropic, and `ANTHROPIC_BASE_URL` works as before.
- The reviewer reads the checkout through `read_file`, `grep` and `glob` and ends by calling `submit_verdict`, which carries the verdict schema on every provider.
- `STAMP_GUARD` bounds each review's cost, tokens, repeated calls, tool calls and time. A model without a price keeps a token ceiling, and `STAMP_PRICING` adds prices.
- The mechanics table shows the model, tool calls, cost and time; the `--json` evidence carries the full run record. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to trace every review.
- `STAMP_BACKENDS` takes model ids, so a second opinion can come from another provider.
- The `claude` and `codex` reviewers run in a pinned Docker image with a private process namespace, a read-only checkout without `.git`, and only their own credential. They need Docker and `CLAUDE_CODE_OAUTH_TOKEN` or `OPENAI_API_KEY`, locally too; the workflow builds the image from the pinned Stamp package.
- The workflow template passes each provider's credentials, shows Bedrock through OIDC, and checks out with no stored token; stamp's fetches authenticate through `gh`.
