---
name: merging-prs
description: >-
  Get a PR approved by stamp and land it. Use when asked to merge a PR, "ship it",
  "land it", "merge when ready", or to get a PR approved. Never merges without an
  explicit instruction in the current conversation; preparing, monitoring, or
  fixing CI is not that instruction.
---

# Merging PRs

Prepare the PR, read Stamp’s verdict and wait for the user’s instruction to merge that PR.

`<n>` is the PR number.

## 1. Preflight

```bash
gh pr view <n> --json state,isDraft,mergeable,reviewDecision,statusCheckRollup,labels,baseRefName
```

Stop and report if: draft, `CONFLICTING`, any check failing, or `reviewDecision` is `CHANGES_REQUESTED`. Fix what you can (rebase, CI) and re-check; never `--no-verify`, never edit a workflow or lower a threshold to get green.

For CLI review workflows, set `STAMP_BUILD_CLI_IMAGE=1` on the posting run. Stamp handles retention or withdrawal before image preparation. Read the verdict and checks on the current head.

## 2. Get the stamp verdict

Label mode: `gh pr edit <n> --add-label stamp`. All-PRs mode: it already ran; read the latest `stamp:` review on the PR.

| Verdict | Meaning | What you do |
|---|---|---|
| ✅ APPROVED | gates passed, no showstoppers | proceed to step 3 |
| ❌ REFUSED | a gate denied it, or a concrete issue was found | read **Next**, fix it, push; label mode re-apply the label |
| 🙋 ESCALATE | risky territory without independent assurance | request the named human/team reviewer; do not re-label to retry |
| ⏳ WAIT / ⚠️ ERROR | no verdict yet | wait for the next run; ERROR twice in a row → tell the user |

An approval survives a base-branch merge that leaves the PR's diff byte-identical, so you need no re-review after updating the branch. Comment `/stamp` to force a fresh review.

Respect the gate’s scope and size policy. Keep file paths and scope intact, report the gate result, and leave policy changes to the maintainer.

## 3. Merge

Only with an explicit instruction from the user for this PR:

```bash
gh pr merge <n> --squash --auto   # --auto waits for required checks
```

Report the merge commit, or the exact reason it did not land.
