---
"@jagreehal/stamp": patch
---

The `claude` and `codex` reviewers reach only their own model API. Each review runs on a private Docker network whose one route out is an egress proxy that serves only that network and tunnels to `api.anthropic.com` or `api.openai.com`, refusing every other host. The `codex` backend passes its key as `CODEX_API_KEY`, the variable `codex exec` reads, taking it from `CODEX_API_KEY` or `OPENAI_API_KEY`.
