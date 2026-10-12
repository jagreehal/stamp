# @jagreehal/stamp

## 0.2.0

### Minor Changes

- 993538b: Rule packs can live in another repository, pinned to a commit on its default branch: `skill: github:owner/repo/<path>@<sha>`. A PR that closes an issue labelled `incident` gets an `incident` scrutiny flag, and the reviewer requires a test that reproduces the failure.
- 59a602f: Review with any AI SDK provider, with review limits, run metrics and traces. Run CLI reviewers in isolated containers that reach only their model API, and accept `CODEX_API_KEY` or `OPENAI_API_KEY` for Codex. Redact credentials from posted reviews, console verdicts and evidence bundles. Add resolved-thread context, review disclosures, policy provenance, author familiarity, folder size grants, approval retention and a weekday digest.
- 83a54e9: Flag suppression comments a PR adds, such as `eslint-disable`, `@ts-ignore`, `noqa` and `nosec`, for the reviewer to check. Scanner settings files join the `quality_gates` scrutiny paths.
- 0c9b336: With `OTEL_EXPORTER_OTLP_ENDPOINT` set, each run is one `stamp.review` span carrying the verdict, tier, failed gates, retention, backends, flags, risk, cost and egress refusal counts, with the model's `gen_ai.*` spans nested under it. CLI reviews report how many connections the egress proxy refused, by kind, in the console and the evidence bundle; the hosts and TLS names a reviewer chose never leave the container.
- ac6e407: The egress proxy tunnels to a CLI reviewer's model API only when the TLS ClientHello names that host, reassembled across records. The reviewer reads the issues a PR closes and checks the diff does what they ask. `writing-pr-descriptions` adds a Merge Danger section from Matt Pocock's `pr` skill, which ships unchanged in `.agents/skills/pr/`.
- ff7ebfe: Teams extend the review with rule packs: `rules:` in `.stamp/policy.yml` points at a `SKILL.md` whose `## Review` rules the reviewer applies to matching files, with `on_break` set to refuse, escalate or note. Packs are read from the default branch, can only add checks, and a PR that edits one needs a human. `stamp rule observability` copies a bundled observability pack into `.stamp/rules/`.
