---
"@jagreehal/stamp": patch
---

- Stamp keeps an approval across a base merge when the merge leaves every file the PR touches as it was. A base edit to one of those files sends the PR back for review.
- Retention reads the last reviewed marker in a review body, and stamp removes HTML comments from model-written review text.
- When both reviewers approve, each approval passes the evidence check on its own.
