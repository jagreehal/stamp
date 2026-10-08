---
"@jagreehal/stamp": minor
---

Teams extend the review with rule packs: `rules:` in `.stamp/policy.yml` points at a `SKILL.md` whose `## Review` rules the reviewer applies to matching files, with `on_break` set to refuse, escalate or note. Packs are read from the default branch, can only add checks, and a PR that edits one needs a human. `stamp rule observability` copies a bundled observability pack into `.stamp/rules/`.
