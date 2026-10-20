---
title: "Use Stamp with Shepherd"
---

Use Shepherd to review and fix changes, and Stamp to decide approval. You keep the merge decision.

1. Install Stamp's workflow and configure its model secret using the [first-run guide](/stamp/start/quickstart/).
2. Install Shepherd's skills in your coding agent and merge its repository policy. Choose the fix mode you want.
3. Run `/shepherd 42` in the agent. In push mode, Shepherd reviews and fixes the PR, then waits for Stamp on the current head.
4. Read the final review and CI results before you merge. Shepherd leaves decisions it cannot make for you.

In Stamp label mode, Shepherd applies the label once per head. Without a label, Stamp reviews pushes through its workflow. Stamp may retain an approval across a base merge only when its retention checks hold.

Shepherd's automated comments can post through the author's account. Stamp labels those as automated context, rather than counting them as independent review assurance. Shared rule packs can steer the reviewer and fixer while each tool keeps its own permissions.

Declare lenses once. Set `rules_from: { shepherd: {} }` in `.stamp/policy.yml` and stamp reads shepherd's lenses, packs included, as rule packs. A lens's `gate` sets how stamp treats a broken rule. Read [declare lenses once](/stamp/configuration/rule-packs/#declare-lenses-once-with-shepherd).

Read [Shepherd's setup guide](https://github.com/jagreehal/shepherd/blob/main/docs/src/content/docs/start/quickstart.md) and [shared lenses](https://github.com/jagreehal/shepherd/blob/main/docs/src/content/docs/configuration/lenses.md).
