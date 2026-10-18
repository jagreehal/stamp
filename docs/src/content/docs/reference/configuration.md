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

Deny and scrutiny path patterns are regexes, not globs. Use single-quoted YAML strings for regex backslashes. `rules.<name>.applies_to` uses globs. Read [gates and tiers](/stamp/configuration/policy/) for the matching rules and bundled categories.

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
| `rules` | Empty map | Team rule packs, keyed by a lowercase name (`a-z`, digits, `-`) |
| `rules.<name>.skill` | Required string | Repository-relative skill path or `github:owner/repo/path@<full-sha>` |
| `rules.<name>.applies_to` | All changed files | Globs selecting files for a rule pack |
| `rules.<name>.on_break` | `escalate` | `refuse`, `escalate`, or `note` |

Both override ceilings must be present when `overrides` is set, and each must cover the global limit. When you configure familiarity, provide the strong and moderate thresholds together. Familiarity and test evidence remain advisory; they cannot override gates.

## Guidance files

| File | Purpose |
| --- | --- |
| `.stamp/policy.yml` | Deterministic gates and reviewer context |
| `.stamp/review-guidance.md` | Instructions for the scoped model review |
| `.stamp/steering.md` | Optional repository-specific review steering |
| Configured rule-pack `SKILL.md` | Team rules from its `## Review` section |
| `AGENT_APPROVALS.md` | Folder size grants, within the policy ceilings |
| `CODEOWNERS` | Advisory ownership context |

Stamp reads these inputs from the trusted default branch. Read [team examples](/stamp/configuration/examples/) and inspect the [bundled policy](https://github.com/jagreehal/stamp/blob/main/.stamp/policy.yml) before editing yours.
