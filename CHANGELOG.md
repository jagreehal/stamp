# @jagreehal/stamp

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
