---
title: "Configure Stamp for your team"
---

Start from `stamp init`'s complete `.stamp/policy.yml`. A replacement policy must include its required fields and preserve the self-protection category.

## Add review rules

In your terminal:

```bash
bunx @jagreehal/stamp rule observability
```

Review the generated `.stamp/rules/observability/SKILL.md`, then add this fragment to your existing policy:

```yaml
rules:
  observability:
    skill: .stamp/rules/observability
    applies_to: ['src/**']
    on_break: escalate
```

Commit and merge the rule file with its policy entry. Expect the reviewer to apply the rules to matching files on later PRs. A rule pack can add scrutiny but cannot pass a deterministic gate that failed.

## Share a rule pack across repositories

Use a pack pinned to a full commit SHA:

```yaml
rules:
  observability:
    skill: github:acme/policy/lenses/observability@0123456789abcdef0123456789abcdef01234567
    applies_to: ['src/**']
    on_break: escalate
```

Replace the repository, path and SHA; give Stamp's `gh` identity read access to the pack repository. Keep the `## Review` section in the supported rule format. Read the team-rules section in [policy and gates](/stamp/configuration/policy/#team-rules) for trust and failure handling.

## Review a polyglot repository

Compose shepherd's stack packs in `.shepherd/config.yml` and let stamp read them:

```yaml
# .stamp/policy.yml: add to your existing policy
rules_from:
  shepherd:
    on_break: escalate
```

```yaml
# .shepherd/config.yml
extends:
  - github:jagreehal/shepherd/packs/nextjs.yml@<sha>   # React and Next.js
  - github:jagreehal/shepherd/packs/go.yml@<sha>
  - github:jagreehal/shepherd/packs/rust.yml@<sha>
  - github:jagreehal/shepherd/packs/java.yml@<sha>
  - github:jagreehal/shepherd/packs/dotnet.yml@<sha>
lenses:
  go:
    applies_to: ['services/**/*.go']
  rust:
    gate: refuse
```

Each pack brings one lens scoped to its files. The repository entries narrow `go` to the services directory and make every `rust` rule refuse. Replace `<sha>` with a commit on jagreehal/shepherd's main branch.

## Narrow or drop a deny category

Your `deny:` list is the whole list: a category you delete stops denying. In a strict policy, to send workflow edits to the model instead of a human, take `\.github/workflows` out of `infra_cicd`:

```yaml
deny:
  infra_cicd:
    description: Infrastructure and deployment artifacts.
    match:
      any: ['terraform', 'kubernetes', 'helm']
      paths: ['k8s', 'dockerfile', 'iam', 'deploy\.sh']
```

You can't remove `stamp_policy`: the schema requires it. The PR that edits the policy hits `stamp_policy` itself, so a maintainer approves it, and the change applies once it merges to the default branch. Run `stamp <pr> --policy-dir .stamp --dry-run` first to see which gates the new list fires on a real PR.

## Change a size limit

Edit `size_gate` in the generated policy, and keep any configured override ceilings at or above the new global limits. A size exemption changes the counted size, not whether Stamp reviews the file. Ask a maintainer to review the policy change.

## Strict starting policy

The bundled policy denies only edits to stamp's own policy and sends everything else to the reviewer, with auth, secrets, migrations, infrastructure, billing, public API and toolchain files flagged for extra scrutiny. To send those areas to a human instead, start from the strict policy: `stamp init --strict` writes it. The docs checker validates it with the engine's policy schema.

```yaml validate-config
# stamp merge-gate policy, strict: `stamp init --strict` writes this one.
# Auth, secrets, migrations, infrastructure, billing, public API and toolchain
# changes always go to a human.
#
# Read from the repository's DEFAULT BRANCH, never from the PR head, so a PR
# cannot rewrite the policy that gates it. Patterns are regexes matched
# case-insensitively on word boundaries. Keep them single-quoted.
version: 1

# Settings. Each is optional; a non-blank environment variable of the same meaning overrides it (STAMP_MODEL,
# AWS_REGION, STAMP_GUARD, ...), and `stamp config` shows every value in effect and where it came from.
# Secrets never go here. Without a price for the model, the $ budget cannot fire ("budget guard inactive").
# model: bedrock:minimax.minimax-m2.5
# backends: [api, bedrock:openai.gpt-oss-120b-1:0]   # primary, then a second opinion
# pricing:
#   minimax.minimax-m2.5: { inputPer1M: 0.3, outputPer1M: 1.2 }
# provider: { region: eu-west-1 }                    # also base_url (compatible:) and anthropic_base_url
# guard: { budget_usd: 2, tokens: 3m, loop: 4/12, max_tools: 80, timeout: 15m }
# max_output_tokens: 16000
# cli: { claude_model: claude-sonnet-5-5, codex_model: gpt-5.5 }
# label: stamp                                        # review only PRs carrying this label
# notify: { on: [REFUSED, ESCALATE, ERROR] }
# telemetry: { endpoint: https://otlp.example.com, service: stamp }
# advise_on_deny: true                                # on a gate denial, still ask the model; its findings ride on the refusal, never approve

# How posted reviews look. Leave out for the defaults. Glyph keys: APPROVED, REFUSED, ESCALATE,
# ERROR, pass, fail, fix.
# branding:
#   name: stamp
#   avatar: https://example.com/logo.png
#   emoji: { ESCALATE: ⚠️ }

# T2: never AI-approved. Any changed file matching a `paths` or `any` pattern
# denies the PR before the LLM runs. `any` and `titles` patterns also scan the
# PR title, but a title hit is only a scrutiny flag for the reviewer, never a
# denial on its own (calibrated against ~440 PRs: most title-only hits were
# incidental mentions humans approved unchanged).
deny:
  auth:
    description: Authentication and authorization surfaces.
    match:
      any: ['auth', 'login', 'signup', 'oauth', 'saml', 'sso', 'oidc', 'credential', 'password', '2fa', 'mfa', 'two[_-]?factor']
      titles: ['authenticated', 'authorized']
      paths: ['session_auth', 'session_token', 'permission']
  crypto_secrets:
    description: Cryptography, secrets, and key material.
    match:
      any: ['crypto', 'encrypt', 'decrypt', 'vault']
      paths: ['secret', 'api[_-]?key', 'private[_-]?key', 'signing[_-]?key', 'certificate', '\.env', '\.pem']
  migrations:
    description: Database and schema migrations.
    match:
      paths: ['migrations/', 'schema_change', 'drizzle/', 'prisma/migrations']
  infra_cicd:
    description: Infrastructure, CI, and deployment artifacts.
    match:
      any: ['terraform', 'kubernetes', 'helm']
      paths: ['k8s', 'dockerfile', 'docker-compose', '\.github/workflows', 'iam', 'cloudflare', '(?:^|/)bin/deploy', 'deploy\.sh', 'vercel\.json', 'fly\.toml']
  billing:
    description: Payments and billing.
    match:
      any: ['billing', 'payment', 'stripe', 'invoice', 'pricing']
  public_api:
    description: Public API contracts and schemas.
    match:
      any: ['openapi', 'api_schema', 'swagger', 'public_api']
  deps_toolchain:
    description: Lockfiles and toolchain/build files. Manifests (package.json) without a lockfile change are flagged for the reviewer instead.
    match:
      paths: ['pnpm-lock\.yaml', 'package-lock\.json', 'yarn\.lock', 'bun\.lock', 'uv\.lock', 'poetry\.lock', 'Cargo\.lock', 'Gemfile\.lock', 'go\.sum', 'requirements[-\w]*\.(txt|in)', 'Makefile', '\.tool-versions', '\.nvmrc']
  stamp_policy:
    description: stamp's own policy, engine, and gate inputs. The gate cannot approve edits to itself.
    match:
      paths: ['\.stamp/', 'stamp/src/', 'CODEOWNERS', 'AGENT_APPROVALS\.md', '\.github/workflows/stamp(-edited|-digest)?\.ya?ml']

# T0: docs/tests/config only. Still LLM-reviewed, lighter bar.
allow:
  path_patterns: ['docs/', 'README', 'CHANGELOG', 'LICENSE', 'CONTRIBUTING', '.gitignore', '.editorconfig', '__snapshots__/']
  extensions_only: ['.md', '.mdx', '.txt', '.rst', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.snap']

# Substantive lines/files (docs, tests, snapshots, lockfiles, images excluded).
# Backtest: denied PRs that merged unchanged cluster at 500-750 lines;
# past ~800 the merged-unchanged rate collapses, so escalation is right there.
size_gate:
  max_lines: 800
  max_files: 30

# Contract ceilings for per-folder AGENT_APPROVALS.md grants. A folder may raise
# size_gate within these ceilings; grants are read from the default branch only.
overrides:
  size_gate.max_lines: { ceiling: 1000 }
  size_gate.max_files: { ceiling: 50 }

# Author familiarity: judgment layer only, never a gate.
familiarity:
  strong:
    min_blame_overlap_pct: 70
  moderate:
    min_prior_prs: 5
    max_days_since_touch: 180

tiers:
  T1a-trivial: { max_lines: 20, max_files: 3 }
  T1b-small: { max_lines: 100, max_files: 5 }
  T1c-medium: { max_lines: 300, max_files: 15 }

# Scrutiny paths: never deny on their own, but the reviewer is told these files changed and what
# would make the change a refusal. Deterministic detection, LLM judgment. This is how "CI is the
# wall that does not move" gets enforced: an agent will weaken a gate to reach green, and a linter
# cannot see its own config being loosened.
scrutiny:
  quality_gates:
    description: Lint, type-check, test and coverage configuration.
    paths: ['\.oxlintrc', 'oxlint\.config', 'eslint\.config', '\.eslintrc', 'biome\.json', 'vitest\.config', 'vitest\.workspace', 'vite\.config', 'jest\.config', 'playwright\.config', 'codecov', '\.nycrc', 'ruff\.toml', 'pytest\.ini', 'mypy\.ini', '\.pre-commit-config', 'lefthook', '\.husky/', 'tools/oxlint/', '\.semgrepignore', '\.gitleaks\.toml', '\.gitleaksignore', '\.bandit', '\.golangci', '\.hadolint\.ya?ml', '\.shellcheckrc', '\.rubocop', '\.trivyignore']
    instruction: REFUSE if a rule was disabled or downgraded, an ignore pattern widened, a coverage threshold lowered, a strict flag turned off, a test made skip/only, a hook removed, or a scanner rule or path excluded. Tightening is fine.
  review_agents:
    description: Configuration and house rules that review and fix agents follow on later PRs.
    paths: ['\.shepherd/', '\.claude/skills/', '\.agents/skills/', '(?:^|/)AGENTS\.md$', '(?:^|/)CLAUDE\.md$', '(?:^|/)REVIEW\.md$', 'docs/adr/']
    instruction: These files decide how agents review and fix future PRs. REFUSE if a lens was removed, its applies_to narrowed, a Review rule deleted or weakened, Fix guidance loosened (fewer Never touch or Escalate entries), or a house rule relaxed, or REVIEW.md told to skip a path or class of finding, lower a severity or cap findings. Adding or tightening rules is fine.

# Bots that leave 👀 while reviewing; stamp waits for them before judging.
reviewer_bots: ['greptile-apps[bot]', 'coderabbitai[bot]', 'chatgpt-codex-connector[bot]', 'claude[bot]']

# Review services that report as a check run on the head; stamp waits while one is queued or running.
reviewer_checks: ['Claude Code Review']
```

After merging, run `bunx @jagreehal/stamp 42 --dry-run` on a test PR and inspect the gates. Read [policy reference](/stamp/reference/configuration/) for field meanings.
