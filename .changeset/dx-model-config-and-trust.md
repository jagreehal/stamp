---
"@jagreehal/stamp": minor
---

Every non-secret setting now lives in `.stamp/policy.yml`, so you review a settings change like any policy change.

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
