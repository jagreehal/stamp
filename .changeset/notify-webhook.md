---
"@jagreehal/stamp": minor
---

- `STAMP_NOTIFY_WEBHOOK` posts each refused, escalated or failed review to Slack or any JSON endpoint. `STAMP_NOTIFY_ON` picks the verdicts, and a PR the gates hold reads as needing a person.
- `STAMP_API_KEY` holds the key for whichever provider `STAMP_MODEL` names, so a repository keeps one secret.
- The `deepseek:` provider reviews through DeepSeek's API.
- A dry run checks the gates and calls no outside service.
- `Gemfile.lock` joins the lockfiles in `deps_toolchain`.
- The workflow templates pin `setup-bun` to a commit.
- A documentation site covers setup, policy, backends and operations.
