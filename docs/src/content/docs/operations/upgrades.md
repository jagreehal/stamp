---
title: "Upgrade and maintain your setup"
---

Review a version upgrade in its own PR. Commit your current policy and workflow files before you change them.

## Update the package

Choose the release you want to run and substitute its version:

```bash
bun add -g @jagreehal/stamp@<version>
```

If you use `bunx`, include `@<version>` when reproducibility matters. Update the version in your GitHub Actions workflows too. An existing workflow continues to use its pinned version until you edit it.

## Update generated files

The setup commands keep existing files. Rerunning setup does not upgrade a workflow you already have. Compare your files with the templates at the chosen release and carry over the changes you need, including permissions, triggers, action pins (the templates pin `oven-sh/setup-bun` to a commit SHA) and credential handling, such as the `STAMP_API_KEY` and `STAMP_NOTIFY_WEBHOOK` lines in the review step's `env`.

Review custom policy separately from engine changes. Both tools read repository policy from the default branch, so an unmerged policy edit does not govern a PR run.

## Check an upgrade

Run the first-run checks on a test PR. Confirm the expected verdict or mode, check the diff and GitHub writes, and verify notifications if you enabled them. Keep the previous version available so you can restore the workflow pin if the upgrade fails.

Read the [changelog](https://github.com/jagreehal/stamp/blob/main/CHANGELOG.md) for release changes and [Shepherd integration](/stamp/integrations/shepherd/) for the other half of the review loop.
