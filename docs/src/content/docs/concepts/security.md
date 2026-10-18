---
title: "Trust and approval safety"
---

stamp runs an LLM over untrusted PR content, so it trusts nothing the PR ships.

```mermaid
flowchart TD
    PR[Untrusted PR content] --> F[Untrusted-content fence in the prompt]
    F --> M[Model with read-only tools<br/>confined to the repository]
    POL[Policy from the default branch<br/>or the bundled default] --> G[Gates]
    G --> V[Verdict]
    M --> V
    V --> SC[Scrub credentials,<br/>neutralize Markdown images]
    SC --> GH[Post to GitHub,<br/>pinned to the reviewed commit]
```

- stamp reads policy from the default branch or the bundled default, never from the checkout.
- The reviewer's tools are read-only and confined to the repository, symlinks included.
- Hooks, MCP config, `CLAUDE.md`, `AGENTS.md` and `.codex/` in the checkout are content, not configuration, on every backend.
- stamp scrubs posted bodies and neutralizes Markdown images.
- A supersession protocol governs approvals: no approval survives a re-review, a retarget, a newer run's verdict, or a push that changes the PR's diff. A push that leaves the diff byte-identical keeps it only through [approval retention](/stamp/operations/approval-retention/).
- A verdict alert goes out only after the posted verdict is confirmed current, and a failing webhook never changes a verdict.
- stamp auto-approves only people who could merge anyway.

[AGENTS.md](https://github.com/jagreehal/stamp/blob/main/AGENTS.md) holds the details and invariants.
