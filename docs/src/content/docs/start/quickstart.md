---
title: "Run your first review"
---

Try the gates on an existing PR, then install the GitHub Actions workflow when you want posted reviews.

## Prerequisites

You need Bun 1.2 or later, Git, and an authenticated GitHub CLI (`gh`). Use a clone with an `origin` remote pointing to the GitHub repository and an existing open PR. For the first example, choose a non-draft PR from a branch in that repository by a collaborator.

```bash
bun --version
git remote -v
gh auth status
gh pr view 42
```

Replace `42` with your PR number. `gh pr view` should show the PR you intend to review. Fix authentication or repository selection before continuing.

## 1. Try the gates

In your terminal, from the repository root:

```bash
bunx @jagreehal/stamp 42 --dry-run
```

Stamp prints each gate and a gate verdict. This command makes no model call and posts no review. An exit code of `1` means a gate denied the PR; inspect the reason rather than treating that as an installation failure.

## 2. Install repository configuration

```bash
bunx @jagreehal/stamp init
```

Expect `.stamp/policy.yml`, `.stamp/review-guidance.md` and three workflows under `.github/workflows/`. Stamp keeps files that already exist. Review the generated policy before you merge it.

## 3. Configure a model

Add your provider's key as the `STAMP_API_KEY` repository Actions secret. Stamp sends it to whichever provider `STAMP_MODEL` names. Without `STAMP_MODEL` the model is `claude-opus-5` on Anthropic. To use another model, set `STAMP_MODEL` as a repository Actions **variable**, for example `deepseek:deepseek-flash`. Use the [provider table](/stamp/reference/backends/) to choose another provider or an isolated CLI backend. The CLI backends require Docker; the API backend does not.

Keep `STAMP_MODEL`, `STAMP_BACKEND` and the other non-secret settings in variables, not secrets. GitHub masks a secret's value everywhere in the logs, so `STAMP_BACKEND=api` stored as a secret would replace every "api" in the run log with `***`.

In repository **Settings → Actions → General**, enable **Allow GitHub Actions to create and approve pull requests** if you intend its reviews to satisfy a required approval rule.

Keep secrets in Actions secrets or your terminal environment. Do not commit them to policy files.

## 4. Choose the trigger and merge setup

The generated workflow reviews PRs without a trigger label by default. To opt individual PRs in, set `STAMP_LABEL: stamp` in the review step's environment. Keep the workflow's withdrawal events and concurrency logic intact.

Commit and merge the setup. Stamp reads policy from the default branch; changes on the setup PR do not replace the trusted policy for that PR.

## 5. Read the first posted review

Open a test PR or push to an existing one after setup reaches the default branch. In label mode, apply the configured label. Inspect the `stamp` workflow in Actions and the review on the PR.

Expect `APPROVED`, `REFUSED`, `ESCALATE` or `ERROR`. Read [verdicts](/stamp/guides/verdicts/) for the action to take. Check the `stamp-evidence-<PR number>` artifact (it holds `stamp.json`) for the run's evidence. A branch rule may still require CI or a code owner's approval.

To request another review, comment `/stamp` on the PR as a collaborator. In label mode a refusal removes the trigger label; reapply it when you want another automatic review.

## Next steps

Add [team policy](/stamp/configuration/examples/), configure [notifications](/stamp/integrations/notifications/), or use [Shepherd](/stamp/integrations/shepherd/) to work through review findings. If no review arrives, use [troubleshooting](/stamp/operations/troubleshooting/).
