---
"@jagreehal/stamp": minor
---

Add author familiarity, per-folder size grants, approval retention and a Slack digest.

- Familiarity: stamp reads git blame and the author's merged PRs from default-branch history and gives the reviewer a STRONG or MODERATE band. The band informs judgment and never changes a gate.
- Size grants: an `AGENT_APPROVALS.md` on the default branch can raise a folder's size ceiling, up to the `overrides:` limits in `policy.yml`.
- Retention: a push that leaves the PR diff byte-identical keeps the approval, as long as the label, draft state, every gate and the live PR all still check out. `/stamp` forces a fresh review.
- Digest: `stamp digest` posts recent stamp-approved merges to Slack once you set `STAMP_SLACK_WEBHOOK`. `stamp init` installs its workflow.
