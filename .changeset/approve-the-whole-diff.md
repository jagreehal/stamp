---
"@jagreehal/stamp": minor
---

An approval covers the whole diff. When a diff runs past the prompt limit, the `api` reviewer reads the omitted files through `read_diff`, and stamp counts a page as read once the model receives it. An approval over unread diff, or from a CLI backend that reports no reads, escalates and names the lines still missing.

The reviewer gets impact leads: changed exports, the files outside the PR that name them, and the tests beside each changed source file.

`bun run eval` reviews seven frozen changes through stamp's own path and scores unsafe approvals, false holds, bug recall, cost and latency. `bun run eval export` writes a case as a repository, so you can score another reviewer on the same changes.

Each run writes its verdict and reviewer cost to the Actions step summary, with model text rendered inert. The README and docs carry the stamp artwork.
