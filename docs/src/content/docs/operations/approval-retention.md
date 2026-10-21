---
title: "Retain approval across an unchanged diff"
---

```mermaid
flowchart TD
    P[New push on an approved PR] --> Q{PR diff byte-identical<br/>to the approved one?}
    Q -- no --> D[Dismiss approval, review again]
    Q -- yes --> C{Label still on in label mode,<br/>out of draft, gates pass today?}
    C -- no --> D
    C -- yes --> K[Keep the approval,<br/>skip the review]
```

A push that leaves the PR's unified diff byte-identical to the approved one keeps the standing approval and skips re-review. That covers a base merge that touched none of the PR's files. A base merge that edits a file the PR touches sends the PR back for review, since the base edit can change what the PR's code does. The new head's CI still runs. stamp keeps it only while the trigger label stays on, the PR stays out of draft, every gate passes against today's policy, and the PR still matches what stamp checked. Empty diffs, binaries or compare errors send the PR down the normal dismiss-and-review path. A `/stamp` comment starts a fresh review.
