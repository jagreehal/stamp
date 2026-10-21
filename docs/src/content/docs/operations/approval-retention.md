---
title: "Retain approval across an unchanged diff"
---

```mermaid
flowchart TD
    P[New push on an approved PR] --> Q{PR diff has the approved<br/>one's patch id?}
    Q -- no --> D[Dismiss approval, review again]
    Q -- yes --> C{Label still on in label mode,<br/>out of draft, gates pass today?}
    C -- no --> D
    C -- yes --> K[Keep the approval,<br/>skip the review]
```

A push that leaves the PR's change the same as the approved one, usually a base-branch merge, keeps the standing approval and skips re-review. "The same" means the same `git patch-id --verbatim`: a base merge that shifts the PR's hunks, or edits a file the PR touches outside them, changes the diff's line numbers and blob ids but not the patch id. Whitespace still counts, since indentation is code in some languages, and each file's paths, modes and renames must match exactly. The base may move the PR's hunks as a block; a base merge that adds or removes lines between two of them sends the PR back for review. The new head's CI still runs. stamp keeps it only while the trigger label stays on, the PR stays out of draft, every gate passes against today's policy, and the PR still matches what stamp checked. Empty diffs, binaries or compare errors send the PR down the normal dismiss-and-review path. A `/stamp` comment starts a fresh review.
