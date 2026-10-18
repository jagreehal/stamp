---
title: "Author familiarity"
---

When policy sets `familiarity:` (the bundled policy does), stamp measures how well the author knows the changed code from git blame and their merged PRs in those paths. It reads default-branch history only. STRONG and MODERATE bands reach the reviewer as trusted facts and never touch a gate. A missing signal or band NONE leaves the review as strict as before.
