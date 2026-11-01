# Review benchmark

These cases measure the verdicts that matter to an approval bot, so you can compare models, backends, guidance
edits and other reviewers on the same changes.

A **case** (`cases/<name>/case.json`) freezes a change: its base files, its head files, whether a safe reviewer
approves it (`expect: approve | block`), and the bugs a person confirmed in it, each with patterns an issue must
match. A **run** reviews one case through stamp's own path (the prompt, impact leads, read tools, then the `assured`
and `readAll` checks the CLI applies) and records the verdict, the model's own verdict, the issues, the cost and
the time.

## Run it

```bash
STAMP_MODEL=bedrock:eu.amazon.nova-micro-v1:0 bun run eval run evals/cases --label nova-micro --repeat 3
bun run eval score evals/runs
```

Set the model and key as for a review. Runs land in `evals/runs/<label>/<started-at>/<case>-<n>.json`, which git
ignores. `--case <name>` runs one case.

## Read the scores

| Column | Meaning |
| --- | --- |
| `unsafe_approvals` | Approvals of a `block` case. Keep this at 0 |
| `false_holds` | `approve` cases held back: a cost to the team |
| `bug_recall` | Bugs found over bugs listed, across completed runs |
| `unmatched_issues` | Issues that find no listed bug. Read them: one may be a real bug to add to the case |
| `held_by_stamp` | Runs the model approved and stamp's checks held back |
| `cost_usd`, `median_ms` | Total cost (null when a run reported none) and median latency |

An issue finds a bug when it names the bug's file and matches one of its patterns.

## Score another reviewer

`bun run eval export evals/cases/<name> <dir>` writes the case as a repository: the base on `main`, the change on
`pr`. Push it, open the PR, let the other reviewer review it, and write its result as a run record
(`case`, `label`, `verdict`, `issues`, `costUsd`, `durationMs`) under `evals/runs/<label>/`. `score` reads every
record the same way.

## Add a case

Freeze a change you reviewed: a refusal a person confirmed, an approval that later proved wrong, or a clean change
stamp held back. Mark `split: "held-out"` on cases you keep out of tuning, so a guidance edit is judged on changes
it was not written against.
