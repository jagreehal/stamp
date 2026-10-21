---
"@jagreehal/stamp": minor
---

- Approval retention matches the PR's change by `git patch-id --verbatim`, so a base merge that shifts line numbers keeps the approval. Whitespace changes still trigger a review.
- Each approval names the fact the change is safe because of and how the reviewer checked it: `claimed`, `cited`, `traced` or `tested`. A high-risk approval on a claimed fact escalates to a person.
