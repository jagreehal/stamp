/**
 * The PR's stamp card: one issue comment, rewritten each run, with the latest verdict and two checkboxes. Ticking a
 * box edits the comment, and the `issue_comment: edited` event acts on it: "Review again" in stamp.yml's review job,
 * "Hand to shepherd" in stamp-actions.yml. It is an issue comment because people with write access can tick a task
 * list there, and the tick fires that event.
 */
import type { Verdict } from "./github.ts";

export const CARD_MARKER = "<!-- stamp-actions -->";

export const ACTIONS = { rereview: "Review again", shepherd: "Hand to shepherd" } as const;

export type Action = keyof typeof ACTIONS;

const ALL: Action[] = ["rereview", "shepherd"];

const box = (action: Action, ticked: boolean) => `- [${ticked ? "x" : " "}] <!-- stamp-action:${action} --> ${ACTIONS[action]}`;

/** The card for one verdict. "Hand to shepherd" is offered when the repository runs shepherd and stamp did not approve. */
export function renderCard(args: { heading: string; verdict: Verdict; head: string; reviewId: number; shepherd: boolean }): string {
  const actions: Action[] = ["rereview", ...(args.shepherd && args.verdict !== "APPROVED" ? (["shepherd"] as const) : [])];

  return [CARD_MARKER, `**${args.heading}** <sub>on <code>${args.head.slice(0, 7)}</code> · <a href="#pullrequestreview-${args.reviewId}">full review</a></sub>`, "", ...actions.map((a) => box(a, false))].join("\n");
}

/** The actions whose box the edit ticked: checked now, unchecked before. */
export function ticked(before: string, after: string): Action[] {
  return ALL.filter((a) => after.includes(box(a, true)) && before.includes(box(a, false)));
}
