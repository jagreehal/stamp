---
title: "Choose a setup"
---

Choose the task you want to complete before you configure models or shared policy.

| Your task | Start with | Result |
| --- | --- | --- |
| Check a change before you open a PR | [Shepherd local review](https://github.com/jagreehal/shepherd/blob/main/docs/src/content/docs/guides/local-review.md) | Findings or fixes in your working tree |
| Review an existing PR and work through findings | [Shepherd first run](https://github.com/jagreehal/shepherd/blob/main/docs/src/content/docs/start/quickstart.md) | Findings, local fixes, or pushed fixes under your team policy |
| Give eligible PRs a GitHub approval | [Stamp first run](https://github.com/jagreehal/stamp/blob/main/docs/src/content/docs/start/quickstart.md) | Approval, refusal, escalation, or an error |
| Keep review and repair running in CI | [Shepherd GitHub Actions](https://github.com/jagreehal/shepherd/blob/main/docs/src/content/docs/integrations/github-actions.md) | One iteration per trigger, with a scheduled recovery sweep |

You can adopt either tool first. You need Stamp for the Shepherd loop to report a PR ready to merge. You can use Shepherd for reviews and local fixes without Stamp.

## Commands and where to enter them

A **terminal** command starts with `bunx`, `shepherd`, `stamp`, `gh`, or `git`. Run it from a clone of the repository you want to review unless a guide says otherwise.

An **agent** command starts with `/`, such as `/shepherd 42`. Enter it in your coding agent after you install the skills. Your harness must support loading skills and the subagents those skills use. Agent scheduling commands such as `/loop` depend on the harness; the GitHub Actions path provides a separate way to schedule work.

## Start with one repository

Choose a test PR whose changes you understand. Read the findings and resulting diff before you broaden adoption. A tool reporting a completed review does not mean the PR has approval, green CI, or the required human reviews.

Read the [Stamp first-run guide](/stamp/start/quickstart/) for a complete setup path.
