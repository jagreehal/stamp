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
So the body has one job: hand the reviewer the intent they would otherwise have to reconstruct from the diff.

## Shape

```
<one line: the effect a person sees, present tense>

## Why
<the problem, one or two sentences; link the issue if one exists>

## What changed
- one fact per bullet, active voice, under 25 words
- mechanism, not narration of the diff

## Ruled out
- <alternative> — <why not>, one line each. Empty section is fine; a missing one is not.

## Evidence
- tests: <command run> → <pass/fail counts, pasted, not paraphrased>
- review: <`/codex:review` or `/codex:adversarial-review` findings, and what you did with each; or "not run">
- manual: <what you actually exercised, or "none">
- risk: <what breaks if this is wrong, and how it is reversed>
```

## Rules

- **Lead with the effect.** The first line is what a user or maintainer observes, not what the code does. "Exports no longer time out on large cohorts", not "Add pagination to export query".
- **Undisclosed behavior is a refusal.** stamp compares the diff against this body. Any substantive behavior in the diff that the body does not mention gets extra scrutiny, and in risky territory (auth, billing, migrations, deps, CI, data writes, prompts fed from user input) it is refused outright. If you touched it, say it.
- **Get a second model's review before a human's.** If the Codex plugin is installed, run `/codex:review` (or `/codex:adversarial-review` for anything touching auth, billing, migrations, deps, CI, or data writes) before opening the PR, fix what it finds, and list the findings and their resolution under Evidence. A PR that arrives pre-reviewed by a different model is cheaper to review and is what lets stamp count "independent assurance" in risky territory.
- **Evidence is pasted, never claimed.** "Tests pass" is a claim. `bun test → 41 pass, 0 fail` is evidence. If you did not run it, write "not run" and why.
- **Test edits get their own line.** If you changed an assertion, deleted a test, or added `skip`/`only`, list each one under Evidence with the reason. A reviewer reads those hunks first; make them cheap to check.
- **Size the body to the change.** A ten-line fix gets a four-line body. Only the first line and Evidence are mandatory.
- **One PR, one intent.** If "What changed" needs two unrelated groups of bullets, it is two PRs. Keep diffs a human can read in one sitting: under ~300 substantive lines is the tier stamp reviews quickly; over 800 it refuses.
- No idioms, no "this PR", no "we". Sentences under 25 words.

## Check before posting

Read only the title, the first line, and the first bullet of each section. A reviewer who stops there must know why the PR exists and what it does. If they would not, reorder; do not add.
