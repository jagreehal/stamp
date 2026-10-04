---
"@jagreehal/stamp": minor
---

stamp reads the review threads, disclosures and commits that review agents leave on a PR.

- Review threads come with their resolution, open threads first, and the trusted context counts unresolved ones.
- shepherd's "Changes made during review" section is read on its own, and the author's account updating it triggers a review.
- Commit subjects and `Shepherd:` / `Shepherd-Lens:` trailers reach the reviewer as untrusted claims.
- A new `review_agents` scrutiny group covers `.shepherd/`, agent skills, `AGENTS.md`, `CLAUDE.md` and `docs/adr/`.
- File names and gate messages stay on one line in the prompt, and a truncated diff names what it leaves out.
- Any bot account carrying stamp's run marker counts as stamp, so App tokens sweep their own approvals.
- An empty COMMENTED review no longer counts as independent assurance.
- Verdicts separate blocking issues from notes, and the fix prompt asks the agent to verify each finding first.
- The evidence and mechanics footer record which policy, guidance and steering ran.
