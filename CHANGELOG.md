# @jagreehal/stamp

## 0.10.0

### Minor Changes

- 6e3d9c6: The reviewer refuses a bug it can show: an ordinary input on which new code returns something other than what its name, doc comment, description or test says. It refuses a change that brings back a problem a resolved review thread named, and a new test the bug in the same diff passes. Each issue opens with `file:line` and a title, and a bug gives the input, the actual and expected result, and the fix. Reviews show the merge risk under the verdict and number their issues, so a reply can name one.

## 0.9.0

### Minor Changes

- 94e3950: Reviews read one line per part. You see the verdict and its reasoning, then collapsed sections for issues, test evidence, gates and the reviewer run. Each new verdict folds earlier reviews under a "Superseded" line, so the PR shows one current verdict.
  
  Stamp keeps a card comment on each PR with the latest verdict and two checkboxes. **Review again** re-runs the review. **Hand to shepherd** dispatches Shepherd's workflow when the verdict is not an approval. Only someone who can merge can act on either. `stamp init` installs the new `stamp-actions.yml` for the handoff.
  
  Test evidence gains the `weakened` finding kind. A scenario that checks less than on the base branch turns an approval into `ESCALATE`. Stamp waits up to five minutes for an evidence run still in progress, accepts a run merged into a newer base, and reviews again before keeping an approval reached without the evidence.

## 0.8.0

### Minor Changes

- 3661e28: `.stamp/policy.yml` ships with a JSON schema, so your editor completes and checks the policy as you type. Policy errors name their line and column, and `stamp config` lists each one.

## 0.7.0

### Minor Changes

- 1dd107e: Every non-secret setting now lives in `.stamp/policy.yml`, so you review a settings change like any policy change.
  
  - The bundled policy denies only edits to stamp's own policy. Auth, secrets, migrations, infrastructure, billing, public API and toolchain changes go to the reviewer as scrutiny flags with a category-specific instruction. `stamp init --strict` writes the policy that sends them to a human. The bundled guidance has the reviewer verify a risky change itself and escalate only a risk it cannot resolve.
  
  - New policy keys: `model`, `backends`, `pricing`, `provider.{region,base_url,anthropic_base_url}`, `guard`, `max_output_tokens`, `cli.{claude_model,codex_model}`, `label`, `notify.on`, `telemetry.{endpoint,service}`, `advise_on_deny` and `branding`. A non-blank environment variable overrides each one.
  - `stamp config` prints each effective setting and its source, and shows secrets as set or unset.
  - `stamp init --model --region` writes the policy, so your first run needs only the secret. Init pins the workflows to the version you ran, takes `--environment <name>` for the review and digest jobs, adds the digest only with `--digest`, and prints suggested CODEOWNERS entries.
  - `stamp init --upgrade` rewrites existing workflows from the current templates and keeps each one's environment, OIDC and region.
  - `--policy-dir <dir>` tries a policy on a real PR before you merge it. Stamp refuses it with `--post`.
  - `advise_on_deny: true` appends the model's findings to a gate refusal. The verdict stays REFUSED.
  - `branding` sets the review header name, an https avatar and the verdict and gate glyphs. Stamp escapes every value.
  - Write access through a team or a private org membership counts as COLLABORATOR, for PR authors and `/stamp` commenters.
  - Stamp reads the verdict out of a model's narration, and ends in ERROR when the reply holds conflicting verdicts. A model that skips the forced `submit_verdict` call gets one more turn.
  - The templates grant `issues: read` for PR reactions, and stamp drops blank provider variables before any provider SDK loads.
  - The run log names the variable each model key comes from, and says when `STAMP_API_KEY` wins over the provider's own. A failed review's ERROR names it too.
  - `stamp --help` and `stamp <command> --help` print the usage.

## 0.6.1

### Patch Changes

- 5d30b68: - Stamp keeps an approval across a base merge when the merge leaves every file the PR touches as it was. A base edit to one of those files sends the PR back for review.
  - Retention reads the last reviewed marker in a review body, and stamp removes HTML comments from model-written review text.
  - When both reviewers approve, each approval passes the evidence check on its own.

## 0.6.0

### Minor Changes

- f1b772e: - Approval retention matches the PR's change by `git patch-id --verbatim`, so a base merge that shifts line numbers keeps the approval. Whitespace changes still trigger a review.
  - Each approval names the fact the change is safe because of and how the reviewer checked it: `claimed`, `cited`, `traced` or `tested`. A high-risk approval on a claimed fact escalates to a person.

## 0.5.0

### Minor Changes

- 9d08c44: - Rule packs take `only` and `disable` to pick rules by id, and `rules_from: { shepherd }` reads the repository's shepherd lenses and model tiers so both tools share one policy.
  - Stamp reviews a stacked PR against its parent's head and holds it until a maintainer or stamp approves the parent. A `base` gate names the long-lived branch a PR belongs on.
  - Edits to any file in a local rule pack's directory need a person.
  - The `openai:` and `compatible:` providers join the list. `STAMP_BASE_URL` points `compatible:` at any OpenAI-style endpoint, and `STAMP_MAX_OUTPUT_TOKENS` fits models with a smaller output limit.
  - Bedrock runs on an API key in `STAMP_API_KEY` or on GitHub OIDC, which `stamp init --aws-oidc` switches on.

## 0.4.0

### Minor Changes

- 184c513: - `STAMP_NOTIFY_WEBHOOK` posts each refused, escalated or failed review to Slack or any JSON endpoint. `STAMP_NOTIFY_ON` picks the verdicts, and a PR the gates hold reads as needing a person.
  - `STAMP_API_KEY` holds the key for whichever provider `STAMP_MODEL` names, so a repository keeps one secret.
  - The `deepseek:` provider reviews through DeepSeek's API.
  - A dry run checks the gates and calls no outside service.
  - `Gemfile.lock` joins the lockfiles in `deps_toolchain`.
  - The workflow templates pin `setup-bun` to a commit.
  - A documentation site covers setup, policy, backends and operations.
- a972673: - A `telemetry` gate holds a PR that writes a credential or a whole request's headers, body or cookies into a log or span, before the model runs.
  - The observability rule pack grows to thirteen rules covering traces across every boundary, trace-linked logs, errors with their cause, request identifiers, alertable metrics, and safe telemetry startup and shutdown.
- 7edf202: - A `tests` gate holds a PR for a person when it deletes a test file or adds a skip or only marker to a test.
  - `stories:` in policy.yml shows the reviewer the executable-stories report your CI uploads, matched to the commit its tests ran on.
  - `reviewer_checks` holds the review while a listed check run, such as Claude Code Review, is running. `review_agents` covers `REVIEW.md`.
  - Bedrock signs requests through the AWS credential chain when `AWS_BEARER_TOKEN_BEDROCK` is unset, so `AWS_PROFILE` and SSO work.
  - The `stamp.review` span carries the base SHA, the CI run, usage counts and `stamp.cost_complete`.
  - Updated the AI SDK providers, autotel, zod and yaml.

## 0.3.0

### Minor Changes

- e99c8cd: Review with Groq or Mistral through their AI SDK providers: `STAMP_MODEL=groq:openai/gpt-oss-120b` with `GROQ_API_KEY`, or `STAMP_MODEL=mistral:mistral-small-latest` with `MISTRAL_API_KEY`.

## 0.2.0

### Minor Changes

- 993538b: Rule packs can live in another repository, pinned to a commit on its default branch: `skill: github:owner/repo/<path>@<sha>`. A PR that closes an issue labelled `incident` gets an `incident` scrutiny flag, and the reviewer requires a test that reproduces the failure.
- 59a602f: Review with any AI SDK provider, with review limits, run metrics and traces. Run CLI reviewers in isolated containers that reach only their model API, and accept `CODEX_API_KEY` or `OPENAI_API_KEY` for Codex. Redact credentials from posted reviews, console verdicts and evidence bundles. Add resolved-thread context, review disclosures, policy provenance, author familiarity, folder size grants, approval retention and a weekday digest.
- 83a54e9: Flag suppression comments a PR adds, such as `eslint-disable`, `@ts-ignore`, `noqa` and `nosec`, for the reviewer to check. Scanner settings files join the `quality_gates` scrutiny paths.
- 0c9b336: With `OTEL_EXPORTER_OTLP_ENDPOINT` set, each run is one `stamp.review` span carrying the verdict, tier, failed gates, retention, backends, flags, risk, cost and egress refusal counts, with the model's `gen_ai.*` spans nested under it. CLI reviews report how many connections the egress proxy refused, by kind, in the console and the evidence bundle; the hosts and TLS names a reviewer chose never leave the container.
- ac6e407: The egress proxy tunnels to a CLI reviewer's model API only when the TLS ClientHello names that host, reassembled across records. The reviewer reads the issues a PR closes and checks the diff does what they ask. `writing-pr-descriptions` adds a Merge Danger section from Matt Pocock's `pr` skill, which ships unchanged in `.agents/skills/pr/`.
- ff7ebfe: Teams extend the review with rule packs: `rules:` in `.stamp/policy.yml` points at a `SKILL.md` whose `## Review` rules the reviewer applies to matching files, with `on_break` set to refuse, escalate or note. Packs are read from the default branch, can only add checks, and a PR that edits one needs a human. `stamp rule observability` copies a bundled observability pack into `.stamp/rules/`.
