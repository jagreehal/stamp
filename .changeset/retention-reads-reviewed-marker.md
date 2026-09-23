---
"@jagreehal/stamp": patch
---

Approval retention now works after "Update branch". GitHub moves a standing approval onto the merge commit, so stamp reads the head each of its reviews covered from its own marker instead of the review's `commit_id`.
