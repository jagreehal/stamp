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
bunx @jagreehal/stamp init --model deepseek:deepseek-flash
```

Leave out `--model` for `claude-opus-5` on Anthropic. For Bedrock, add the region too: `--model bedrock:minimax.minimax-m2.5 --region eu-west-1`. Expect `.stamp/policy.yml` with those settings written in, `.stamp/review-guidance.md`, and three workflows under `.github/workflows/` (four with `--digest`). Stamp keeps files that already exist. Review the generated policy before you merge it. It sends every change except stamp's own policy to the reviewer, flagging auth, secrets, migrations, infrastructure, billing and dependency changes for extra scrutiny. Add `--strict` to send those areas to a human instead. Every setting lives in that file (the [settings table](/stamp/reference/configuration/#settings) lists them), so changing one later is a reviewed PR, not a hidden repository variable.

## 3. Add the one secret

Add the secret `stamp init` names for your model (`AWS_BEARER_TOKEN_BEDROCK` for Bedrock, `ANTHROPIC_API_KEY` for Anthropic, and so on; `STAMP_API_KEY` works for any provider) as an Actions secret. It's the only thing the first run needs; stamp sends it to whichever provider `model` names. Use the [provider table](/stamp/reference/backends/) to choose another provider or an isolated CLI backend. The CLI backends require Docker; the API backend does not. With `stamp init --environment ai-review`, store it as an environment secret of `ai-review` instead, so no other workflow can read it.

In repository **Settings → Actions → General**, enable **Allow GitHub Actions to create and approve pull requests** if you intend its reviews to satisfy a required approval rule.

Keep secrets in Actions secrets or your terminal environment, never in policy files.

To check what a run will use, run `bunx @jagreehal/stamp config`. It prints every setting, its value and whether it came from the policy, an environment variable or the default, and reports each secret as set or unset.

## 4. Choose the trigger and merge setup

The generated workflow reviews every PR by default. To review only PRs that carry a label, set `label: stamp` in `.stamp/policy.yml`. Keep the workflow's withdrawal events and concurrency logic intact.

Commit and merge the setup. Stamp reads policy from the default branch; changes on the setup PR do not replace the trusted policy for that PR.

## 5. Read the first posted review

Open a test PR or push to an existing one after setup reaches the default branch. In label mode, apply the configured label. Inspect the `stamp` workflow in Actions and the review on the PR.

Expect `APPROVED`, `REFUSED`, `ESCALATE` or `ERROR`. Read [verdicts](/stamp/guides/verdicts/) for the action to take. Check the `stamp-evidence-<PR number>` artifact (it holds `stamp.json`) for the run's evidence. A branch rule may still require CI or a code owner's approval.

The review reads one line per part: the verdict and its reasoning, then collapsed sections for issues, test evidence, gates and the reviewer run. Each new verdict folds stamp's earlier reviews under a one-line "Superseded" summary, so the PR shows one current verdict.

Stamp also keeps one card comment on the PR, rewritten each run, with the latest verdict and two checkboxes. Ticking **Review again** re-runs the review. On a verdict that is not an approval, in a repository that runs Shepherd, ticking **Hand to shepherd** dispatches Shepherd's workflow for the PR (`stamp-actions.yml` does that, with `actions: write` and nothing else). Both act only for someone who could merge.

To request another review, you can also comment `/stamp` on the PR as a collaborator. In label mode a refusal removes the trigger label; reapply it when you want another automatic review.

## Next steps

Add [team policy](/stamp/configuration/examples/), configure [notifications](/stamp/integrations/notifications/), or use [Shepherd](/stamp/integrations/shepherd/) to work through review findings. If no review arrives, use [troubleshooting](/stamp/operations/troubleshooting/).
