// Live smoke: runs the real reviewer over a fake PR against this checkout.
// Verifies toolRunner + output_config.format parse to a verdict. Costs one small call.
//   ANTHROPIC_API_KEY=... bun run src/smoke-live.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { BACKENDS, review } from "./reviewer.ts";
import type { PR } from "./github.ts";

const root = path.resolve(import.meta.dir, "..");

const pr: PR = {
  number: 0,
  title: "fix: treat an empty tiers map as T1d instead of throwing",
  body: "## Why\ntier() should not depend on the map having entries.\n\n## What changed\n- comment only, no behaviour change\n\n## Evidence\n- tests: bun test → 9 pass",
  author: "smoke",
  authorAssociation: "OWNER",
  isFork: false,
  isDraft: false,
  mergeable: "MERGEABLE",
  baseRef: "main",
  defaultBranch: "main",
  headSha: "0000000",
  baseSha: "0000000",
  labels: [],
  files: [{ filename: "src/policy.ts", additions: 1, deletions: 0, status: "modified" }],
  reviews: [],
  inline: [],
  discussion: [],
  reactions: [],
  diff: `--- a/src/policy.ts
+++ b/src/policy.ts
@@ -116,6 +116,7 @@ export function tier(policy: Policy, files: PRFile[], denied: string[]): { tier:
   const { lines, files: n } = substantiveSize(files);
+  // An empty tiers map falls through to T1d-complex below.
   for (const [name, t] of Object.entries(policy.tiers)) {
     if (lines <= t.max_lines && n <= t.max_files) return { tier: "T1-agent", sub: name };
   }`,
};

const verdict = await review(
  BACKENDS[0]!,
  {
    pr,
    gates: [
      { gate: "prerequisites", passed: true, message: "ready" },
      { gate: "deny-list", passed: true, message: "no sensitive paths" },
      { gate: "size", passed: true, message: "1 substantive lines / 1 files (limit 800/30)" },
      { gate: "tier", passed: true, message: "T1-agent / T1a-trivial" },
    ],
    gateVerdict: "PASSED",
    tier: "T1-agent / T1a-trivial",
    titleFlags: [],
    manifests: [],
    scrutiny: [],
  },
  readFileSync(path.join(root, ".stamp/review-guidance.md"), "utf8"),
  root,
  true,
);

console.log(JSON.stringify(verdict, null, 2));
