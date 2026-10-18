---
title: "Stamp documentation"
---

Use Stamp to review pull requests and post GitHub approvals under your team's policy. Stamp runs deterministic gates before a model reviews the code. You decide when to merge.

Start with [your first review](/stamp/start/quickstart/). You can try the gates from your terminal before you install the approval workflow.

## Find your task

| You want to | Read |
| --- | --- |
| Decide whether you need Stamp, Shepherd, or both | [Choose a setup](/stamp/start/choose-a-setup/) |
| Connect a repository to GitHub Actions | [First run](/stamp/start/quickstart/) |
| Understand a refusal, escalation, or error | [Verdicts](/stamp/guides/verdicts/) |
| Set approval limits and paths | [Policy reference](/stamp/reference/configuration/) |
| Add your team's review rules | [Team examples](/stamp/configuration/examples/) |
| Choose a model or CLI backend | [Backends and providers](/stamp/reference/backends/) |
| Diagnose a run that did not approve | [Troubleshooting](/stamp/operations/troubleshooting/) |

## The approval boundary

Stamp can approve eligible PRs; it can also refuse, escalate to a person, or fail before judging. A model cannot override a failed gate. Stamp reads policy from the default branch and ties a review to the head and base it examined. Read [trust and approval safety](/stamp/concepts/security/) before you use its approval in a branch rule.
