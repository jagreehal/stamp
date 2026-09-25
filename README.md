# stamp

stamp is an approve-first pull request reviewer.

It runs deterministic gates and a scoped LLM review over a PR and, when the policy allows it, posts a real GitHub approval instead of comments.

Repositories opt in one at a time, and nothing else is touched.

Beyond the gates and the review, stamp reports git-blame familiarity, honours per-folder size grants (`AGENT_APPROVALS.md` on the default branch), keeps an approval across pushes that leave the diff byte-identical, and can post a daily Slack digest.

## What a PR author sees

A repository either reviews every PR or waits for its trigger label, depending on its review mode.
The engine returns one of four verdicts, and `--post` puts it on the PR.

| Verdict  | Where it lands                              | Trigger label in label mode |
| -------- | ------------------------------------------- | --------------------------- |
| APPROVED | A real GitHub review by the stamp login     | Kept                        |
| REFUSED  | A GitHub comment review by the stamp login  | Removed                     |
| ESCALATE | A GitHub comment review by the stamp login  | Removed                     |
| ERROR    | A GitHub comment review by the stamp login  | Kept, retries               |
| Gated    | A GitHub comment review by the stamp login  | Removed                     |

Gated means a deterministic gate denied the PR before any review, such as the deny-list or the size ceiling.
The engine reports it as `REFUSED`, and still removes the trigger label because a human has to take it from here.

The bot never posts request-changes.

Approvals are posted as real reviews so they count toward branch protection, once, pinned to the reviewed commit, carrying the review body.

Every other verdict is posted once per run as a comment review on the same surface.

The trigger label only exists in label-triggered mode, and only a substantive non-approval removes it.

So the label can be re-applied once the feedback is addressed.

A verdict that says nothing about the PR keeps the label, and the next push retries.

`ERROR` means the run failed before it could judge the PR, because the model backend was unreachable or the reviewer returned something that was not a verdict.

In CI the stamp login is `github-actions[bot]`.

Every non-approval carries a collapsed **Fix with a coding agent** block: the verdict, the issues and the requested next step as one copyable prompt, with the rule that weakening a test or a lint rule to clear the review is itself a refusal. Most PRs stamp reviews were written by an agent, and that is where the fix loop starts.

Commenting `/stamp` on a PR re-runs the review, so a fix does not need an empty commit to be re-checked. Only OWNER, MEMBER and COLLABORATOR comments trigger it.

A local `--post` uses the account `gh` is logged in as.

Each run can write an evidence bundle (`--json`), and the workflow uploads it as an artifact.

## Connect a repository

1. From the repository you want reviewed, run `bunx @jagreehal/stamp init`. It writes `.stamp/policy.yml`, `.stamp/review-guidance.md`, `.github/workflows/stamp.yml` and `.github/workflows/stamp-digest.yml`, and never overwrites a file that exists.
2. Add the secret for your backend. `ANTHROPIC_API_KEY` for the API, or `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) with the repository variable `STAMP_BACKEND` set to `claude`.
3. Settings → Actions → General → turn on **Allow GitHub Actions to create and approve pull requests**. Without it the approval is posted but does not satisfy a required-reviews rule.
4. Pick a **review mode**. Leave `STAMP_LABEL` unset and every pull request is reviewed. Set `STAMP_LABEL: stamp` in the workflow env and only PRs carrying that label are reviewed.
5. Merge. Policy is read from the default branch, so it takes effect once it lands.

The workflow runs on open, push, reopen, ready-for-review, label, unlabel and base retarget.
It pins the engine version, because the engine decides what gets auto-approved and a bump should be a deliberate PR.

Start with one repository, all-PRs mode, and a spend cap on the key.

## Customize the review for your repository

Customization is optional.

A repository with no `.stamp/` directory reviews under the bundled defaults in [`.stamp/`](.stamp/).

The `.stamp/` files are read from the repository's **default branch**, never from the PR head, so a PR cannot rewrite the policy that gates it.
When the default branch carries no such file, the bundled default is used, however many `.stamp/` files the PR adds.

| File                 | Required | Default when absent      | How it combines with the default                 |
| -------------------- | -------- | ------------------------ | ------------------------------------------------ |
| `policy.yml`         | No       | The bundled policy       | Replaces the bundled policy wholesale            |
| `review-guidance.md` | No       | The bundled norms        | Replaces the bundled prose wholesale             |
| `steering.md`        | No       | Nothing is added         | Appended under "Repository-specific steering"    |

Folder `AGENT_APPROVALS.md` files (any directory) raise size ceilings within `overrides:`; they are not under `.stamp/` but are still deny-listed and read from the default branch only.

Every edit to these files is deny-listed (`stamp_policy`), so the gate cannot approve changes to itself.

The same category covers `CODEOWNERS`, which is a gate input, and `stamp/src/` for a repository that vendors the engine.

### Tiers

| Tier             | Lines | Files | Meaning                                    |
| ---------------- | ----- | ----- | ------------------------------------------ |
| T0-deterministic | –     | –     | Docs, tests, config only. Lighter bar.     |
| T1a-trivial      | ≤20   | ≤3    |                                            |
| T1b-small        | ≤100  | ≤5    |                                            |
| T1c-medium       | ≤300  | ≤15   |                                            |
| T1d-complex      | more  | more  | Full read, still under the ceiling.        |
| T2-never         | –     | –     | Deny-listed. A human, always.              |

Size calibrates scrutiny effort, never risk by itself.

A large well-tested refactor outside risky territory can be approved; a five-line billing change cannot.

### T2 — never AI-approved

Deny-listed categories where even a small diff can have high blast radius:

| Category           | Patterns                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------- |
| **auth**           | auth, login, signup, oauth, saml, sso, oidc, credential, password, 2fa, mfa, permission, …   |
| **crypto_secrets** | crypto, encrypt, decrypt, vault, secret, api_key, private_key, certificate, `.env`, `.pem`   |
| **migrations**     | `migrations/`, `drizzle/`, `prisma/migrations`, schema_change                               |
| **infra_cicd**     | terraform, kubernetes, helm, k8s, dockerfile, `.github/workflows`, iam, cloudflare, `deploy.sh`, `vercel.json`, `fly.toml` |
| **billing**        | billing, payment, stripe, invoice, pricing                                                  |
| **public_api**     | openapi, api_schema, swagger, public_api                                                    |
| **deps_toolchain** | lockfiles, `requirements*.txt`, Makefile, `.nvmrc`, `.tool-versions`                        |
| **stamp_policy**   | `.stamp/`, `stamp/src/`, CODEOWNERS                                                         |

Only file paths hard-deny.

A rename counts on both paths, so moving a file out of `auth/` is a change to `auth/`.
PR-title keywords never deny on their own.

They surface as scrutiny flags the reviewer must verify against the diff: REFUSE if the change behaviorally touches the flagged domain, judge normally if incidental.

A calibration against ~440 deny-listed PRs set that split: most title-only hits were incidental mentions that humans approved unchanged.

Word patterns match on boundaries that also break on `_` and `-`, so `secret` matches `secret_key.ts` and not `nosecrets.ts`, and `auth` does not match `author.ts`.

A pattern containing `/` or starting with a dot matches as a path fragment.

Dependency _manifests_ (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `tsconfig*.json`) don't hard-deny either: without a lockfile change they can't pull in third-party code, because CI installs are frozen-lockfile.

Two guards cover the residual risk that manifest scripts or hooks execute in CI.

A deterministic scan compares `scripts`, `husky`, `lint-staged`, `pnpm` and `simple-git-hooks` between base and head as JSON, not as diff lines, because editing an existing script's command never mentions `scripts` on the changed line; any difference hard-denies, and a manifest that fails to parse hard-denies too.

And the reviewer prompt must REFUSE on execution-bearing changes the scan can't name.

Manifest PRs are kept out of the T0 fast path.

### Scrutiny paths

`scrutiny:` in `policy.yml` names files that never deny on their own but are reported to the reviewer with what would make the change a refusal.

The shipped `quality_gates` group is lint, type-check, test and coverage configuration: `.oxlintrc`, `eslint.config`, `biome.json`, `vitest.config`, `codecov`, `.pre-commit-config`, `.husky/` and the rest of that list.

The instruction is to REFUSE a disabled or downgraded rule, a widened ignore, a lowered coverage threshold, a strict flag turned off, a `skip` or `only` on a test, or a removed hook, and to approve tightening.

Agents loosen these files to reach green, and a linter cannot see its own config being loosened.

A path deny would refuse a tightened rule along with a loosened one, so the reviewer judges the diff.

The shipped `review_agents` group covers what review and fix agents follow on later PRs: `.shepherd/`, `.claude/skills/`, `.agents/skills/`, `AGENTS.md`, `CLAUDE.md` and `docs/adr/`.

Its instruction is to REFUSE a removed lens, a narrowed `applies_to`, a deleted or weakened rule, loosened Fix guidance or a relaxed house rule, and to approve additions and tightening.

### Size ceiling

Over 800 substantive lines or 30 substantive files is too large for auto-review.

Docs, snapshots, images, lockfiles and tests don't count toward the ceiling, because they inflate diffs without adding review surface; they still count toward tier classification and still appear in the diff the reviewer reads.

90 days of denial outcomes set the limits: denied PRs that merged unchanged cluster at 500–750 substantive lines, and past ~800 the merged-unchanged rate collapses, so escalation fits there.

Per-folder grants can raise those limits within the `overrides:` ceilings in `policy.yml` (defaults 1000 lines / 50 files). Put an `AGENT_APPROVALS.md` on an ancestor of the changed files:

```yaml
---
stamp:
  size_gate:
    max_files: 40
    max_lines: 900
---
```

Grants are read from the **default branch** only (same trust boundary as policy). Invalid frontmatter is ignored for that file; nearest valid grant wins per key; the whole PR is still bounded by a roof (the most generous ceiling in play). Edits to `AGENT_APPROVALS.md` are deny-listed.

### Author familiarity

When policy sets `familiarity:` (the bundled policy does), stamp measures how well the author knows the changed code from git blame and their merged PRs in those paths, reading default-branch history only. STRONG and MODERATE bands reach the reviewer as trusted facts and never touch a gate. A missing signal or band NONE leaves the review exactly as strict as before.

### Approval retention

A push that leaves the PR's own unified diff byte-identical to the approved one (usually a base-branch merge) keeps the standing stamp approval and skips re-review. stamp keeps it only while the trigger label stays on, the PR stays out of draft, every gate passes against today's policy, and the PR still matches what stamp checked. Empty diffs, binaries or compare errors send the PR through the normal dismiss-and-review path. A `/stamp` comment always starts a fresh review.

### Slack digest

`stamp init` also writes `.github/workflows/stamp-digest.yml`. It stays off until the `STAMP_SLACK_WEBHOOK` secret is set; then a weekday cron posts stamp-approved merges to that webhook's channel: the last 24 hours, or 72 on Monday so the weekend is covered. PR titles and summaries are escaped so they cannot mention or link in Slack.

## Backends

`STAMP_BACKEND` decides who runs the model.
The prompt, the gates and the verdict schema are the same in every case.

| `STAMP_BACKEND` | Runs the review through                                   | Auth                                                                        | Model                                       |
| --------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------- |
| `api` (default) | The Anthropic Messages API, or any endpoint that speaks it | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_BASE_URL`                          | `STAMP_MODEL`, default `claude-opus-5`      |
| `claude`        | Claude Code, headless (`claude -p`)                        | The `claude` login; in CI, `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` | `STAMP_CLAUDE_MODEL`, default Claude Code's |
| `codex`         | Codex, headless (`codex exec`)                             | The `codex` login; in CI, `OPENAI_API_KEY`                                  | `STAMP_CODEX_MODEL`, default Codex's        |

```bash
ANTHROPIC_API_KEY=sk-ant-...                                                        # api: Anthropic direct
ANTHROPIC_API_KEY=<zen key>  ANTHROPIC_BASE_URL=https://opencode.ai/zen              # api: OpenCode Zen, Claude, pay per use
ANTHROPIC_API_KEY=<go key>   ANTHROPIC_BASE_URL=https://opencode.ai/zen/go  STAMP_MODEL=qwen3.8-max   # api: OpenCode Go, $10/mo, no Claude
STAMP_BACKEND=claude                                                                # a Claude subscription, no key
STAMP_BACKEND=codex                                                                 # a ChatGPT login, no key
```

The agent backends load nothing the PR ships as configuration.

How each one is isolated, and what was tested, is in [AGENTS.md](AGENTS.md).

On a comment-only diff, Claude Code grepped the source before approving.

Codex on its default model approved from the diff alone.

Set `STAMP_CODEX_MODEL` to a model that explores.

### Two reviewers

```bash
STAMP_BACKENDS=claude,codex
```

The first backend reviews every PR.

The second runs when the first approves something that is not plainly low-risk: a risk above `low`, or a title, scrutiny, manifest or Jev flag.

It never sees the first verdict.

Both approve, and the PR is approved with the second verdict in the mechanics table as the independent assurance risky territory asks for.

They disagree, and stamp posts ESCALATE with both reasonings, the dissenter's issues and its next step.
A plainly low-risk PR costs one call.

Across 146 real PRs, four commercial reviewers never once flagged the same line, and 93% of findings came from exactly one tool.

Two models from different families miss different things.

### Risk signals

```bash
TYPESAFE_API_KEY=...
```

With a key, stamp asks [Jev](https://docs.typesafe.ai/concepts/system-one) ten yes/no questions about the diff before the reviewer runs: whether the change alters auth, billing, the data model or a public contract, CI or build tooling, dependencies or install scripts, a data write path, or feeds user input into a prompt; whether it weakens tests or CI config; whether it does something the description does not say.

Jev answers with a calibrated probability per question and no prose, in a few hundred milliseconds, for a fraction of a cent.

The probabilities go into the reviewer's trusted context, count as flags at 0.7 and above for the second-opinion trigger, and land in the evidence bundle.

They are never a gate and cannot loosen one.

The reviewer is told a flag is a magnifying glass, and a low probability is not assurance.

Path patterns cannot see behavior.

A PR titled "nicer export filenames" that also inserts an admin grant in `src/export.ts` matches no deny pattern; Jev gave it `undisclosed_behavior` 0.97, `auth` 0.95, `write_path` 0.88.

A test-weakening diff scored `weakens_tests` 0.98; a comment-only diff scored 0.03 across the board.

Those are three calls, not a calibration.

The evidence bundles are where the threshold gets tuned against what you actually merged.

## A team

With a `CODEOWNERS` on the default branch (`.github/`, root or `docs/`), the reviewer is told who owns each changed file and whether the author is a listed owner.

That is advisory, never a gate.

An author who owns what they touched counts as assurance in risky territory; a cross-team author does not, and an ESCALATE names the owning team in its next step.

Team handles (`@org/team`) cannot be resolved to members without an org read the Actions token lacks, so membership is reported as unknown and a teammate's review is the assurance path.

In risky territory stamp will not approve on its own reading.

It needs an APPROVED or substantive COMMENTED review from a human or a different AI reviewer on the current head.

List your other reviewer bots under `reviewer_bots` in `policy.yml` so stamp waits for their 👀 rather than approving over them.

The wait is capped at five minutes, because nothing re-triggers the workflow when a bot finishes: a run that waited indefinitely would never post a verdict at all.

The `github-actions[bot]` approval counts toward required approving reviews once the Actions setting above is on.

It does not satisfy "require review from Code Owners", and it should not: that rule exists so a person on the owning team looks, which is what stamp escalates to.

Copy `.agents/skills/` (`writing-pr-descriptions`, `merging-prs`) into repositories where agents open PRs.

### With shepherd

[shepherd](https://github.com/jagreehal/shepherd) gets a PR ready and hands the head to stamp.

stamp reads shepherd's review threads with their resolution: an unresolved Shepherd thread is a decision left to the author.

It reads the "Changes made during review" section on its own, so a long description never hides the disclosure, and re-reviews when the author's account updates that section.

Commits carrying `Shepherd:` or `Shepherd-Lens:` trailers are listed for the reviewer to read first. A trailer, a swarm summary and an automated comment never count as assurance.

The reviewer checks the diff against the intent, the ruled-out alternatives and the pasted test output in the body.

With the Codex plugin for Claude Code installed, the skill has the agent run `/codex:review` before opening the PR and list the findings under Evidence.

## Local review

```bash
# run from inside the repository you want reviewed
bunx @jagreehal/stamp 42

# dry run (gates only, no LLM calls)
bunx @jagreehal/stamp 42 --dry-run

# post the verdict to GitHub
bunx @jagreehal/stamp 42 --post

# save the full result as JSON, show tool calls
bunx @jagreehal/stamp 42 --json /tmp/review.json -v

# post the Slack digest of stamp-approved merges from the last 48 hours
STAMP_SLACK_WEBHOOK=https://hooks.slack.com/... bunx @jagreehal/stamp digest --since 48
```

Requires [bun](https://bun.sh) and the `gh` CLI authenticated.

The exit code is 0 on APPROVED and 1 on every other verdict.
`--dry-run` turns `--post` off.

## How it runs

```text
--post: dismiss stamp's standing approvals (the PR number is enough)
  │
  ▼
Fetch the PR
  │
  ▼
Prerequisites (hard gate)
  - Not draft, no merge conflicts
  - No standing "changes requested" review (a later comment does not clear one)
  - Author is OWNER, MEMBER or COLLABORATOR; head is on this repository, not a fork
  - Author is not a bot
  │
  ▼
Deny-list (hard gate)
  - Checks file paths, both ends of a rename, against the categories above
  - Manifest scripts scan
  │
  ▼
Credential scan (hard gate)
  - Unambiguous key shapes on ADDED diff lines only
  │
  ▼
Size ceiling (hard gate)
  │
  ▼
Tier classification
  │
  ▼
Wait for in-flight bot reviews
  - A 👀 from a listed reviewer bot younger than 45 minutes → hold, up to 5 minutes
  - Their comments join the prompt when they post; after 5 minutes stamp reviews without them
  - Older than that is a crashed reviewer, not an in-flight one: ignored
  │
  ▼
Risk signals (with TYPESAFE_API_KEY)
  │
  ▼
LLM review (skipped when a gate denied)
  - Reads files and searches the checkout, nothing else
  - Receives the diff, description, reviews, inline and discussion comments and reactions,
    all inside an untrusted-content fence; stamp's own prior reviews excluded
  - Reads test hunks first; showstoppers only
  - Gates are authoritative: the LLM can tighten but never loosen
  - Second opinion, when configured and warranted
  │
  ▼
Recheck head, base ref and base SHA; post pinned to the reviewed commit; scrub; terminal sweep
```

When HEAD is another commit, or the tree is dirty, stamp reviews from a detached worktree at the PR head.

## Security model

The reviewer runs an LLM over untrusted PR content, so nothing the PR ships is trusted.

Policy comes from the default branch or the bundled default, never the checkout.

The reviewer has read-only tools confined to the repository, symlinks included.
Hooks, MCP config, `CLAUDE.md`, `AGENTS.md` and `.codex/` in the checkout are content, not configuration, on every backend.

Posted bodies are scrubbed and markdown images neutralized.

Approvals are governed by a strict supersession protocol, so no approval survives a re-review, a push, a retarget or a newer run's verdict.

Only people who could merge anyway get auto-approved.

Details and invariants: [AGENTS.md](AGENTS.md).

## Where to read more

- [AGENTS.md](AGENTS.md) - the invariants that keep approvals and the reviewer sound.
- [`.stamp/review-guidance.md`](.stamp/review-guidance.md) - the norms the reviewer works under.
- [`.stamp/policy.yml`](.stamp/policy.yml) - the bundled policy, with the reasoning next to each rule.
- [`templates/stamp.yml`](templates/stamp.yml) - the workflow `init` installs.
