---
"@jagreehal/stamp": minor
---

Reviews read one line per part. You see the verdict and its reasoning, then collapsed sections for issues, test evidence, gates and the reviewer run. Each new verdict folds earlier reviews under a "Superseded" line, so the PR shows one current verdict.

Stamp keeps a card comment on each PR with the latest verdict and two checkboxes. **Review again** re-runs the review. **Hand to shepherd** dispatches Shepherd's workflow when the verdict is not an approval. Only someone who can merge can act on either. `stamp init` installs the new `stamp-actions.yml` for the handoff.

Test evidence gains the `weakened` finding kind. A scenario that checks less than on the base branch turns an approval into `ESCALATE`. Stamp waits up to five minutes for an evidence run still in progress, accepts a run merged into a newer base, and reviews again before keeping an approval reached without the evidence.
