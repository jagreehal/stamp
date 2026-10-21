---
title: "Policy reference"
---

Stamp reads `.stamp/policy.yml` from the default branch. If that branch has no policy file, Stamp uses the bundled policy. A custom policy replaces the bundled policy; it does not merge with it. Start from the generated file rather than writing a fragment as a whole policy.

## Required fields

| Field | Type | Effect |
| --- | --- | --- |
| `version` | `1` | Policy format version |
| `deny` | Map of categories | Deny matching protected paths before a model call |
| `deny.<name>.description` | Optional text | Explain the category |
| `deny.<name>.match.any` | Optional list of regex patterns | Match paths and flag title hits |
| `deny.<name>.match.paths` | Optional list of regex patterns | Match changed paths |
| `deny.<name>.match.titles` | Optional list of regex patterns | Add title scrutiny rather than a denial |
| `allow.path_patterns` | List of strings | Identify paths for the lighter review tier |
| `allow.extensions_only` | List of extensions | Identify changes by extension for the lighter review tier |
| `size_gate.max_lines` | Positive integer | Maximum substantive changed lines |
| `size_gate.max_files` | Positive integer | Maximum substantive changed files |
| `tiers` | Map of names to integer `max_lines` and `max_files` | Describe review size bands |

Keep `deny.stamp_policy`: the schema requires that category so the gate cannot approve its own policy edits. Keep the generated protections when you customise other categories. A lighter tier still receives model review.

Deny and scrutiny path patterns are regexes, not globs. Use single-quoted YAML strings for regex backslashes. `rules.<name>.applies_to` uses globs, and `only` and `disable` use globs over rule ids. Read [gates and tiers](/stamp/configuration/policy/) for the matching rules and bundled categories.

## Optional fields

| Field | Default or limit | Effect |
| --- | --- | --- |
| `overrides.size_gate.max_lines.ceiling` | Absent | Maximum delegated folder line limit |
| `overrides.size_gate.max_files.ceiling` | Absent | Maximum delegated folder file limit |
| `familiarity.strong.min_blame_overlap_pct` | 0–100 | Author-familiarity strong threshold |
| `familiarity.moderate.min_prior_prs` | Positive integer | Prior-PR threshold for moderate familiarity |
| `familiarity.moderate.max_days_since_touch` | Positive integer | Recency threshold for moderate familiarity |
| `stories.workflow` | Required when `stories` is present | Workflow file that uploads test evidence |
| `stories.artifact` | Required when `stories` is present | Artifact name |
| `stories.file` | `index.review.json` | Relative report path inside the artifact, without wildcards or `..` |
| `stories.max_bytes` | 1,000,000; maximum 10,000,000 | Report read limit |
| `scrutiny` | Empty map | Add reviewer attention without a deterministic denial |
| `scrutiny.<name>.paths` | List of regex patterns | Files to scrutinise |
| `scrutiny.<name>.instruction` | Text | Review instruction for those files |
| `scrutiny.<name>.description` | Optional text | Explain the scrutiny category |
| `reviewer_bots` | Empty list | Bot logins whose recent review reactions Stamp waits for |
| `reviewer_checks` | Empty list | Check-run names Stamp waits for while queued or running |
| `long_lived_branches` | `main`, `master`, `develop`, `release`, `release/*`, `staging` | Branch globs a PR is branched from or merged into. A PR whose commits mostly sit on one of these, other than its base, is denied with a retarget command. An empty list turns the check off |
| `rules` | Empty map | Team rule packs, keyed by a lowercase name (`a-z`, digits, `-`) |
| `rules.<name>.skill` | Required string | Repository-relative skill path or `github:owner/repo/path@<full-sha>` |
| `rules.<name>.applies_to` | All changed files | Globs selecting files for a rule pack |
| `rules.<name>.on_break` | `escalate` | `refuse`, `escalate`, or `note`, for rules without a severity tag |
| `rules.<name>.only` | All rules | Rule id globs to keep |
| `rules.<name>.disable` | No rules | Rule id globs to drop |
| `rules_from` | Absent | Build rule packs from another tool's config |
| `rules_from.shepherd.on_break` | `escalate` | `on_break` for shepherd lenses that set no `gate` |
| `branding.name` | `stamp` | The name in each review's header (`## ❌ stamp: REFUSED`), at most 40 characters |
| `branding.avatar` | Absent | An `https://` image shown at 20×20 at the start of the header |
| `branding.emoji.<key>` | Today's glyphs | Override any of `APPROVED` (✅), `REFUSED` (❌), `ESCALATE` (🙋), `ERROR` (⚠️), `pass` (✓), `fail` (✗) and `fix` (🤖, the "Fix with a coding agent" summary). Up to 16 characters, no whitespace |


Both override ceilings must be present when `overrides` is set, and each must cover the global limit. When you configure familiarity, provide the strong and moderate thresholds together. Familiarity and test evidence remain advisory; they cannot override gates.

## Settings

Every non-secret setting lives in `.stamp/policy.yml`, read from the default branch, so changing one is a reviewed change like any other policy edit. Each one can be overridden by an environment variable for an experiment. A non-blank variable wins over the policy, which wins over the default; a blank variable (how a workflow passes an unset one) counts as unset. `stamp config` prints every value in effect and where it came from, and each review logs the settings that are not at their default.

| Setting | Policy key | Env override | Default |
| --- | --- | --- | --- |
| Reviewer model (api backend) | `model` | `STAMP_MODEL` | `claude-opus-5` |
| Backends: primary, then optional second opinion | `backends` (list) | `STAMP_BACKENDS`, then `STAMP_BACKEND` (comma-separated) | `[api]` |
| Prices for models autotel cannot price | `pricing` (`{<model>: {inputPer1M, outputPer1M, cachedInputPer1M?}}`) | `STAMP_PRICING` (JSON) | none; without a price the `$` budget cannot fire, and the run logs `budget guard inactive` |
| AWS region for Bedrock | `provider.region` | `AWS_REGION` | the AWS SDK's own lookup |
| Base URL for `compatible:` models | `provider.base_url` | `STAMP_BASE_URL` | none (required for `compatible:`) |
| Anthropic base URL | `provider.anthropic_base_url` | `ANTHROPIC_BASE_URL` | Anthropic direct |
| Review limits | `guard` (`{budget_usd, tokens, loop, max_tools, timeout}`); a rule left out keeps its default | `STAMP_GUARD` (shorthand, replaces the whole set) | `budget_usd: 2, tokens: 3m, loop: 4/12, max_tools: 80, timeout: 15m` |
| Output-token ceiling per model call | `max_output_tokens` | `STAMP_MAX_OUTPUT_TOKENS` | 16000, or 10000 on Amazon Nova |
| Claude CLI model | `cli.claude_model` | `STAMP_CLAUDE_MODEL` | Claude Code's default |
| Codex CLI model | `cli.codex_model` | `STAMP_CODEX_MODEL` | Codex's default |
| Review only PRs with this label | `label` | `STAMP_LABEL`, or `--label` (the flag wins) | unset: every PR |
| Verdicts that send a notification | `notify.on` (list) | `STAMP_NOTIFY_ON` (comma-separated) | `[REFUSED, ESCALATE, ERROR]` |
| OTLP endpoint for traces | `telemetry.endpoint` | `OTEL_EXPORTER_OTLP_ENDPOINT` | off |
| Trace service name | `telemetry.service` | `OTEL_SERVICE_NAME` | `stamp` |
| On a gate denial, still run the model and append its findings as advice (the verdict stays REFUSED) | `advise_on_deny` | `STAMP_ADVISE_ON_DENY` (`true` or `1`) | `false` |

Telemetry starts once stamp reads the policy, so the policy's `telemetry.endpoint` and `telemetry.service` both apply. The `stamp.review` span is backdated to the start of the run.

**Secrets are environment-only** and never belong in the policy: `STAMP_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `AI_GATEWAY_API_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, `CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_API_KEY`, `TYPESAFE_API_KEY`, `OTEL_EXPORTER_OTLP_HEADERS`, `STAMP_SLACK_WEBHOOK`, `STAMP_NOTIFY_WEBHOOK` and `GH_TOKEN`. `stamp config` reports each one as set or unset, never its value.

**Runner settings stay in the workflow**, because they describe the job rather than the review: `STAMP_BOT_LOGIN` (the login of the token that posts), `STAMP_CLI_IMAGE`, `STAMP_BUILD_CLI_IMAGE` and `STAMP_VERSION`.

## Guidance files

| File | Purpose |
| --- | --- |
| `.stamp/policy.yml` | Deterministic gates and reviewer context |
| `.stamp/review-guidance.md` | Instructions for the scoped model review |
| `.stamp/steering.md` | Optional repository-specific review steering |
| Configured rule-pack `SKILL.md` | Team rules from its `## Review` section |
| `.shepherd/config.yml` | Lenses read as rule packs when `rules_from.shepherd` is set |
| `AGENT_APPROVALS.md` | Folder size grants, within the policy ceilings |
| `CODEOWNERS` | Advisory ownership context |

Stamp reads these inputs from the trusted default branch. Read [team examples](/stamp/configuration/examples/) and inspect the [bundled policy](https://github.com/jagreehal/stamp/blob/main/.stamp/policy.yml) before editing yours.
