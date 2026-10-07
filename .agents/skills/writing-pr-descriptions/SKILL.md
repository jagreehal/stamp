---
name: writing-pr-descriptions
description: >-
  Shape a PR body so a reviewer (human or stamp) can decide where to spend attention
  in seconds. Use ALWAYS before `gh pr create`, `gh pr edit --body`, or when asked to
  improve a description. Puts the effect first and the mechanism under it, records what
  was ruled out, and attaches test evidence. Not for commit messages.
---

# Writing PR descriptions

A PR written by an agent is the first time a human has laid eyes on the code.
The reasoning that produced it is gone unless you write it down here.
Give the reviewer the intent and evidence alongside the diff.

## Shape

```
<one line: the effect a person sees, present tense>

## Why
<the reason for the change; link the issue if one exists>

## What changed
- one fact per bullet, active voice, under 25 words
- mechanism, not narration of the diff

## Evidence
- tests: <command run> → <pass/fail counts, pasted, not paraphrased>
- review: <`/codex:review` or `/codex:adversarial-review` findings, and what you did with each; or "not run">
- manual: <what you actually exercised, or "none">

## Merge Danger
**Door:** <one-way or two-way>
**Blast Radius:** <one word>
<optional: what breaks if this is wrong, and how it is reversed>
```

`../pr/SKILL.md` (Matt Pocock's `pr`) defines the Merge Danger section and the
visuals: read its **Merge Danger** section before you fill this one in. When a
picture makes the change clearer than bullets, add the smallest one its
**Summary** section describes (pseudocode, a call tree, a diff sketch, a
Mermaid diagram) under "What changed". This skill's shape and rules win where
the two differ.

## Rules

- **Lead with the effect.** The first line is what a user or maintainer observes, not what the code does. "Exports no longer time out on large cohorts", not "Add pagination to export query".
- **Describe behavior changes.** Name the user-visible effect of auth, billing, migrations, dependencies, CI, data writes and prompt changes. Stamp compares those details with the diff.
- **Get a second model's review before a human's.** If the Codex plugin is installed, run `/codex:review` (or `/codex:adversarial-review` for anything touching auth, billing, migrations, deps, CI, or data writes) before opening the PR, fix what it finds, and list the findings and their resolution under Evidence. A PR that arrives pre-reviewed by a different model is cheaper to review and is what lets stamp count "independent assurance" in risky territory.
- **CLI review setup.** For `claude` or `codex`, use `STAMP_BUILD_CLI_IMAGE=1` and the backend credential. Record the Linux isolation probe result alongside review evidence.
- **Evidence is pasted, never claimed.** "Tests pass" is a claim. `bun test → 41 pass, 0 fail` is evidence. If you did not run it, write "not run" and why.
- **Test edits get their own line.** If you changed an assertion, deleted a test, or added `skip`/`only`, list each one under Evidence with the reason. A reviewer reads those hunks first; make them cheap to check.
- **Name the door.** A one-way door (data rewritten in place, a removed field clients still send, a migration with no down path) gets a line on how it is undone. Stamp's reviewer reads the claim against the diff.
- **Size the body to the change.** A ten-line fix gets a four-line body. Only the first line, Evidence and Merge Danger are mandatory.
- **One PR, one intent.** If "What changed" needs two unrelated groups of bullets, it is two PRs. Keep diffs a human can read in one sitting: under ~300 substantive lines is the tier stamp reviews quickly; over 800 it refuses.
- No idioms, no "this PR", no "we". Sentences under 25 words.

## Check before posting

Read only the title, the first line, and the first bullet of each section. A reviewer who stops there must know why the PR exists and what it does. If they would not, reorder; do not add.
