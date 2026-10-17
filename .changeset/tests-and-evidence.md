---
"@jagreehal/stamp": minor
---

- A `tests` gate holds a PR for a person when it deletes a test file or adds a skip or only marker to a test.
- `stories:` in policy.yml shows the reviewer the executable-stories report your CI uploads, matched to the commit its tests ran on.
- `reviewer_checks` holds the review while a listed check run, such as Claude Code Review, is running. `review_agents` covers `REVIEW.md`.
- Bedrock signs requests through the AWS credential chain when `AWS_BEARER_TOKEN_BEDROCK` is unset, so `AWS_PROFILE` and SSO work.
- The `stamp.review` span carries the base SHA, the CI run, usage counts and `stamp.cost_complete`.
- Updated the AI SDK providers, autotel, zod and yaml.
