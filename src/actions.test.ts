import { describe, expect, test } from "bun:test";
import { renderCard, ticked } from "./actions.ts";
import { cardFor, foldTargets, supersededBody, type ReviewRecord } from "./github.ts";

describe("stamp card", () => {
  const card = renderCard({ heading: "❌ stamp: REFUSED", verdict: "REFUSED", head: "d997545feb", reviewId: 42, shepherd: true });

  test("offers a re-review always and the shepherd handoff only on a verdict that is not an approval", () => {
    expect(card).toContain("- [ ] <!-- stamp-action:rereview --> Review again");
    expect(card).toContain("- [ ] <!-- stamp-action:shepherd --> Hand to shepherd");
    expect(card).toContain('<a href="#pullrequestreview-42">full review</a>');
    expect(renderCard({ heading: "✅ stamp: APPROVED", verdict: "APPROVED", head: "d997545", reviewId: 1, shepherd: true })).not.toContain("shepherd -->");
    expect(renderCard({ heading: "❌ stamp: REFUSED", verdict: "REFUSED", head: "d997545", reviewId: 1, shepherd: false })).not.toContain("shepherd -->");
  });

  test("an edit acts only on the box it ticked", () => {
    const tick = (a: string) => card.replace(`- [ ] <!-- stamp-action:${a} -->`, `- [x] <!-- stamp-action:${a} -->`);

    expect(ticked(card, tick("rereview"))).toEqual(["rereview"]);
    expect(ticked(card, tick("shepherd"))).toEqual(["shepherd"]);
    expect(ticked(tick("shepherd"), tick("shepherd"))).toEqual([]); // already ticked before this edit
    expect(ticked(tick("rereview"), card)).toEqual([]); // unticking acts on nothing
  });
});

describe("superseded reviews", () => {
  const review = (body: string): ReviewRecord => ({ id: 7, user: { login: "github-actions[bot]" }, state: "COMMENTED", body, commit_id: "c".repeat(40) });
  const body = `## ❌ stamp: REFUSED <sub>· head \`aaaaaaa\`</sub>\n\nwhy\n<!-- stamp-run:2026-10-22T00:00:00Z -->\n<!-- stamp-reviewed:head=${"a".repeat(40)};base=${"b".repeat(40)} -->`;

  test("fold under one line naming the verdict and the latest review, keeping every marker", () => {
    const folded = supersededBody(review(body), 99) ?? "";

    expect(folded.startsWith('<details><summary>Superseded: stamp REFUSED on <code>aaaaaaa</code> · <a href="#pullrequestreview-99">latest review</a></summary>')).toBe(true);
    expect(folded).toContain(body);
    expect(supersededBody(review(folded), 100)).toBeNull(); // folded once
  });

  test("a run folds only runs older than itself, and folds nothing once a newer run has posted", () => {
    const run = (id: number, started: string): ReviewRecord => ({ ...review(body.replace("2026-10-22T00:00:00Z", started)), id });
    const older = run(1, "2026-10-22T09:00:00Z");
    const mine = run(2, "2026-10-22T10:00:00Z");
    const newer = run(3, "2026-10-22T11:00:00Z");

    expect(foldTargets([older, mine], 2, "github-actions[bot]", "2026-10-22T10:00:00Z")).toEqual([1]);
    expect(foldTargets([older, mine, newer], 2, "github-actions[bot]", "2026-10-22T10:00:00Z")).toBeNull();
  });

  test("the card shows the newest run's verdict whichever run computes it, so a late write repairs to the same card", () => {
    const run = (id: number, started: string, verdict: string): ReviewRecord => ({ ...review(body.replace("2026-10-22T00:00:00Z", started).replace("REFUSED", verdict)), id });
    const reviews = [run(3, "2026-10-22T11:00:00Z", "APPROVED"), run(2, "2026-10-22T10:00:00Z", "REFUSED")];
    const card = cardFor(reviews, "github-actions[bot]", true) ?? "";

    expect(card).toContain("**❌ stamp: APPROVED**");
    expect(card).toContain('href="#pullrequestreview-3"');
    expect(card).not.toContain("stamp-action:shepherd"); // an approval offers no handoff
    expect(card.endsWith("<!-- stamp-run:2026-10-22T11:00:00Z -->")).toBe(true);
    expect(cardFor([...reviews].reverse(), "github-actions[bot]", true)).toBe(card);
    expect(cardFor([], "github-actions[bot]", true)).toBeNull();
    expect(cardFor([{ ...reviews[0]!, state: "DISMISSED" }], "github-actions[bot]", true)).toContain("**❌ stamp: APPROVED (withdrawn)**");
  });
});
