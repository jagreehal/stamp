---
"@jagreehal/stamp": minor
---

Re-reviews show the reviewer what changed since the last reviewed head. Refusals and escalations pin each issue to its line, and the next review resolves those threads. Impact leads list renamed or removed names the head still uses. `ERROR` reviews name the fix for provider failures. The new `effort` setting (`STAMP_EFFORT`) sets how hard the reviewer reasons.

Stamp retries transient GitHub failures, fits long reviews within GitHub's limit, trims provider keys, and escalates placeholder approvals.
