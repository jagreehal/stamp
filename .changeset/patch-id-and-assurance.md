---
"@jagreehal/stamp": minor
---

- Approval retention matches the PR's change by `git patch-id --verbatim`, so a base merge that moves the PR's hunks as a block keeps the approval. Changes to whitespace, paths, modes, renames or the spacing between hunks trigger a review.
- Each approval names the fact the change is safe because of and how the reviewer checked it: `claimed`, `cited`, `traced` or `tested`. When either reviewer rates an approval high risk on a claimed fact, it escalates to a person.
