# Stamp

Stamp reviews pull requests and posts GitHub approvals under your team's policy. It runs deterministic gates before a scoped model review. You decide when to merge.

Use it when you want eligible PRs to receive an approval while protected changes, missing assurance and review findings reach a person. Each run records the policy and evidence behind its verdict.

## Start here

- [Run your first review](docs/src/content/docs/start/quickstart.md)
- [Choose Stamp, Shepherd, or both](docs/src/content/docs/start/choose-a-setup.md)
- [Browse the documentation](docs/src/content/docs/index.md)

You need Bun 1.2 or later, Git and an authenticated GitHub CLI. From a clone of the repository, try the gates on an existing PR:

```bash
gh auth status
bunx @jagreehal/stamp 42 --dry-run
```

Replace `42` with your PR number. Expect a gate verdict and the reason for each failed gate. This command posts no review and makes no model call.

To install the repository workflow:

```bash
bunx @jagreehal/stamp init
```

Review the generated policy and pick the reviewer model there (`model:` in `.stamp/policy.yml`, so changing it is reviewed), add your model provider's key as the `STAMP_API_KEY` secret (an environment secret with `stamp init --environment <name>` keeps it out of other workflows), configure GitHub's Actions approval setting and merge the setup. The [first-run guide](docs/src/content/docs/start/quickstart.md) covers each step and the expected first result.

## Understand the result

| Verdict | Your next action |
| --- | --- |
| `APPROVED` | Check the other branch requirements and merge when ready |
| `REFUSED` | Read the failed gate or review finding; fix it or request human review |
| `ESCALATE` | Obtain the requested human decision or independent assurance |
| `ERROR` | Fix the runtime, credential or provider problem and rerun |

A model cannot override a failed gate. Stamp reads policy from the default branch and checks that a posted verdict belongs to the reviewed head and base. See [verdicts](docs/src/content/docs/guides/verdicts.md) and [trust boundaries](docs/src/content/docs/concepts/security.md).

## Configure it for your team

| Task | Guide |
| --- | --- |
| Set protected paths and size limits | [Policy reference](docs/src/content/docs/reference/configuration.md) |
| Add or share review rules | [Team examples](docs/src/content/docs/configuration/examples.md) |
| Choose a provider or CLI backend | [Backends and isolation](docs/src/content/docs/reference/backends.md) |
| Connect a review-and-fix loop | [Use Stamp with Shepherd](docs/src/content/docs/integrations/shepherd.md) |
| Send alerts or approved-merge digests | [Notifications](docs/src/content/docs/integrations/notifications.md) |
| Diagnose a missing approval | [Troubleshooting](docs/src/content/docs/operations/troubleshooting.md) |

## Development

```bash
bun install
bun run check
```

For the docs site, run `bun install --cwd docs --frozen-lockfile`, then `bun run docs:dev`. Run `bun run docs:build` to validate and build it. Read [documentation maintenance](docs/src/content/docs/contributing/docs.md), [contributor contracts](AGENTS.md) and [third-party credits](THIRD_PARTY_NOTICES.md).
