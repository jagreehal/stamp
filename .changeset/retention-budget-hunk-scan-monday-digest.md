---
"@jagreehal/stamp": patch
---

- `/stamp` re-reviews dismiss straight away. Retention checks run under a 2-minute budget, and every `gh` and `git` call has a timeout, so a slow GitHub call ends in dismissal instead of a stale approval.
- The credential gate follows diff hunks, so an added line starting with `++` is scanned like any other.
- The Monday digest looks back 72 hours, covering Friday afternoon and the weekend.
