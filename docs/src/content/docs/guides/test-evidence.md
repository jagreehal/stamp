---
title: "Read CI test evidence"
---

When policy sets `stories:`, stamp reads the [executable-stories](https://github.com/jagreehal/executable-stories) review report your CI uploads, so the reviewer sees which scenarios failed or were skipped and which changed files no scenario covers.

```yaml
stories:
  workflow: ci.yml           # the workflow that runs your tests
  artifact: executable-stories
  file: index.review.json    # path inside the artifact (default)
  max_bytes: 1000000         # default
```

stamp takes the newest run of that workflow for the exact PR head. It goes by the commit the tests ran on, which the report records as `execution.gitSha` (executable-stories-formatters 1.27 or later), never by the `headRef` the report was asked to compare. The run is `ok` when that commit is the head, or GitHub's merge commit whose parents are exactly the reviewed base and the head; a filtered run says it covers only the scenarios that ran. Otherwise stamp reports `stale` (another commit, including a merge into an older base), `pending` (still running), `missing` (no run or no artifact) or `invalid` (no recorded commit, over the size limit, or not a v1 review report). stamp refuses an artifact over 50 MB zipped and reads the one report file out of it, at most `max_bytes`, without unpacking the rest. The status is trusted context; the report's text sits inside the untrusted content.

The report is advisory. The PR's author wrote the tests behind it, so a strong evidence grade, a declared `covers` or an attached trace never waives a gate and never counts as independent assurance. Matching the commit makes the report relevant to this head, nothing more. The workflows need `actions: read`, which both generated workflows grant.
