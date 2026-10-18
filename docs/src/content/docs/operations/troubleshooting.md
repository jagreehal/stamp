---
title: "Troubleshoot a review"
---

Start with the PR's Actions run, review comment and evidence artifact. Separate a gate refusal from a runtime failure before you change configuration.

| Symptom | Check | Next action |
| --- | --- | --- |
| No workflow ran | Setup reached the default branch; event matches the workflow | Open a test PR or push a commit after merging setup |
| No review in label mode | `STAMP_LABEL` and the PR's labels | Add the configured label; a refusal may have removed it |
| Approval does not satisfy branch rules | Actions approval setting and required code-owner reviews | Enable the Actions approval setting; obtain any required human review |
| `REFUSED` before a model call | Failed gates in the review or dry-run output | Fix the problem or request a human review for the protected change |
| `ESCALATE` | Reviewer reasoning and requested assurance | Ask the owning team to review the current head |
| `ERROR` | First error in the review and Actions logs | Check provider credentials, model ID, budget and backend setup |
| CLI backend fails before review | Docker, image preparation, selected backend credential | Follow the isolation setup in the backend guide; Stamp has no host fallback |
| Model/provider error | `STAMP_BACKEND`, `STAMP_MODEL` and the matching key (`STAMP_API_KEY` or the provider's own variable) | Use a provider/model combination from the backend table |
| Edited policy has no effect | Policy source in the evidence | Merge the policy change; PR-head configuration does not govern the run |
| Approval disappears after a push | Head/base changes and retention result | Wait for the current review; retention requires the same diff and passing checks |
| Bot findings arrived after Stamp finished | Reviewer wait is bounded | Comment `/stamp` to request a fresh review with those findings |
| No webhook alert | `STAMP_NOTIFY_ON`, the secret, and `notify webhook` lines in the log | Correct the endpoint or verdict list; the verdict still stands. A dry run, a run without `--post`, a retained approval or a verdict superseded while posting sends nothing |
| Log shows `***` in place of ordinary words | A non-secret setting stored as a secret | Move `STAMP_MODEL`, `STAMP_BACKEND` and similar settings to repository variables; GitHub masks a secret's value everywhere in the log |

## Reproduce from your terminal

```bash
gh auth status
bunx @jagreehal/stamp 42 --dry-run
bunx @jagreehal/stamp 42 --json /tmp/stamp-review.json -v
```

The last command calls the configured model but posts no review without `--post`. Set the model credential in your terminal environment first. Exit code `0` means approval; `1` covers the other verdicts. For a dry run, read the gate verdict.

Do not remove gates to make a test PR pass. A refusal for a protected path is an expected result. Read [policy and gates](/stamp/configuration/policy/) to choose a PR that exercises the approval path.
