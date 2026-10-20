---
title: "Stacked PRs and wrong bases"
---

A PR's `base...head` diff is what lands when it merges. That is the right diff for a lone PR, and the wrong one for two common shapes. Stamp detects both from git ancestry before it reviews. It reads no PR text, so "stacked on #286" in a description changes nothing.

## Stacked PRs

PRs #286, #287 and #288 each target `release`, and each branches from the one before. #287's diff carries #286's change, so a whole-PR review denies #287 on a file #286 wrote and repeats #286's review.

Stamp finds the parent: the nearest open PR into the same base whose head is one of this PR's own commits. Then it:

1. Reviews only the delta, `parent_head...head`. Gates, the deny list, size limits and rule packs all see this PR's files alone, and the reviewer is told the diff is the change over #286.
2. Holds approval until the parent is approved on its current head, or merged. Merged first, #287 would land #286's code too, so an approved delta posts as 🙋 ESCALATE: "Approval waits on #286". Comment `/stamp` on #287 once #286 is approved.
3. Records the parent's head as the reviewed base. [Approval retention](/stamp/operations/approval-retention/) then compares a different diff and re-reviews, so a stacked approval never carries over onto the whole PR.

When the parent merges with a merge commit, the base holds its commits and the next review covers #287's own change as a normal PR. After a squash merge the base holds new SHAs, no open parent remains, and stamp reviews the whole PR again. A delta listing 300 files or more, the compare API's limit, also gets a whole-PR review.

## Wrong bases

PR #289 branches from `release` and targets `main`. Its diff is 45 commits, 44 of them already on `release`. Stamp denies it before the model runs:

> Not reviewed: 44 of 45 commits are already on release: this looks like it should target release (gh pr edit 289 --base release).

The check compares the PR's commits with each branch in `long_lived_branches` other than its base and its own head. A PR whose head is itself a long-lived branch is a promotion, and a branch holding every commit is a backport; both pass. Set `long_lived_branches: []` to turn it off, or list the branches your team uses:

```yaml
long_lived_branches: ['main', 'develop', 'release/*']
```

## Shepherd

`shepherd stack <pr>` runs the same detection. Shepherd's loop and swarm review the stacked delta, post no finding on the parent's lines, and stop with a retarget message on a wrong base. See [Shepherd integration](/stamp/integrations/shepherd/).
