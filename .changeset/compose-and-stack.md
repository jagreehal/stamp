---
"@jagreehal/stamp": minor
---

- Rule packs take `only` and `disable` to pick rules by id, and `rules_from: { shepherd }` reads the repository's shepherd lenses and model tiers so both tools share one policy.
- Stamp reviews a stacked PR against its parent's head and holds it until a maintainer or stamp approves the parent. A `base` gate names the long-lived branch a PR belongs on.
- Edits to any file in a local rule pack's directory need a person.
- The `openai:` and `compatible:` providers join the list. `STAMP_BASE_URL` points `compatible:` at any OpenAI-style endpoint, and `STAMP_MAX_OUTPUT_TOKENS` fits models with a smaller output limit.
- Bedrock runs on an API key in `STAMP_API_KEY` or on GitHub OIDC, which `stamp init --aws-oidc` switches on.
