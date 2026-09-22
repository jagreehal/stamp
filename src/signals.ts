// Risk signals from Jev, TypeSafe's System One model: calibrated probabilities for bounded questions
// about the diff, no prose. It runs before the reviewer and answers the question the gates cannot
// (does this change *behaviorally* enter risky territory?) and the one the reviewer would otherwise
// self-report. Advisory only: the probabilities are shown to the reviewer, decide whether a second
// opinion is worth its cost, and go in the evidence bundle for later calibration. Never a gate, and
// nothing here can loosen one. Skipped when TYPESAFE_API_KEY is unset.
import { z } from "zod";
import type { PR } from "./github.ts";

export const SIGNAL_THRESHOLD = 0.7; // a probability at or above this is a flag; tune from the evidence bundles

const DIFF_CAP = 150_000;

// One yes/no question per dimension, each independently useful. The risky-territory set mirrors the
// review guidance; the last three are the agent failure modes the guidance tells the reviewer to read first.
export const QUESTIONS = {
  auth: { instructions: "Does the change alter authentication, authorization, session, permission, or credential handling?", true: "It changes who can do what, how identity is established, or how secrets are handled.", false: "It does not touch those flows, even if the word appears." },
  billing: { instructions: "Does the change alter billing, payment, quota, plan, or pricing logic?", true: "Money, entitlements, or limits behave differently.", false: "No billing or plan behavior changes." },
  data_model: { instructions: "Does the change alter a database schema, a migration, a stored data format, or a public API contract?", true: "Persisted shapes, migrations, or an externally consumed contract change.", false: "Internal code only; stored data and public contracts are unchanged." },
  ci_build: { instructions: "Does the change alter CI, build, deploy, or release tooling and configuration?", true: "How the project is built, tested in CI, deployed, or released changes.", false: "Application code or docs only." },
  dependencies: { instructions: "Does the change add, remove, or upgrade a third-party dependency, or change install-time or lifecycle scripts?", true: "New or changed third-party code, or scripts that run on install or in CI.", false: "Dependencies and scripts are unchanged." },
  write_path: { instructions: "Does the change alter a path that writes, deletes, or ingests user or customer data?", true: "Data is written, deleted, transformed, or ingested differently.", false: "Read-only, presentational, or unrelated to data writes." },
  prompt_from_user_input: { instructions: "Does the change feed user-controlled text into a language model prompt or tool call?", true: "Untrusted text reaches an LLM call or an agent's instructions.", false: "No LLM prompt is built from user input." },
  weakens_tests: { instructions: "Does the change weaken tests: delete tests, skip them, or rewrite assertions so they pass without verifying the original behavior?", true: "Coverage or assertion strength went down.", false: "Tests were added, tightened, or left alone; refactors that keep the assertions equivalent count as unchanged." },
  weakens_ci: { instructions: "Does the change loosen a lint, type-check, coverage, or hook configuration?", true: "A rule was disabled or downgraded, an ignore widened, a threshold lowered, a strict flag turned off, or a hook removed.", false: "Configuration was tightened or not touched." },
  undisclosed_behavior: { instructions: "Does the diff contain substantive behavior that the title and description do not mention?", true: "The description omits a real behavioral change present in the diff.", false: "The description covers what the diff does." },
} as const;

export type Signal = keyof typeof QUESTIONS;

export type Signals = Record<Signal, number>;

export const SIGNAL_IDS = ["auth", "billing", "data_model", "ci_build", "dependencies", "write_path", "prompt_from_user_input", "weakens_tests", "weakens_ci", "undisclosed_behavior"] as const satisfies readonly Signal[];

type Noul = { type: "noul"; instructions: string; criteria: { true: string; false: string } };

export type SystemOneRequest = {
  model: "jev-latest";
  state: { title: string; description: string; files: string[]; diff: string };
  questions: Record<Signal, Noul>;
};

/** What the reviewer needs from the pull request; nothing else is sent. */
export type SignalInput = Pick<PR, "title" | "body" | "files" | "diff">;

const Response = z.object({
  answers: z.record(z.string(), z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) })),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
});

export function requestBody(pr: SignalInput): SystemOneRequest {
  const questions: Partial<Record<Signal, Noul>> = {};

  for (const id of SIGNAL_IDS) questions[id] = { type: "noul", instructions: QUESTIONS[id].instructions, criteria: { true: QUESTIONS[id].true, false: QUESTIONS[id].false } };

  return {
    model: "jev-latest",
    state: {
      title: pr.title,
      description: pr.body,
      files: pr.files.map((f) => `${f.filename} (+${f.additions}/-${f.deletions})`),
      diff: pr.diff.slice(0, DIFF_CAP),
    },
    // SAFETY: the loop above assigned every id in SIGNAL_IDS, which enumerates every Signal.
    questions: questions as Record<Signal, Noul>,
  };
}

export async function riskSignals(pr: SignalInput): Promise<Signals | null> {
  const key = process.env.TYPESAFE_API_KEY;

  if (!key) return null;

  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody(pr)),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`typesafe ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const parsed = Response.parse(await res.json());
  const out: Partial<Signals> = {};

  for (const id of SIGNAL_IDS) {
    const a = parsed.answers[id];

    if (!a) throw new Error(`typesafe: no answer for ${id}`);
    out[id] = a.noul;
  }

  // SAFETY: the loop above assigned every id in SIGNAL_IDS or threw, so no signal is missing.
  return out as Signals;
}

/** The signals at or above the threshold, strongest first. */
export const flagged = (s: Signals, threshold = SIGNAL_THRESHOLD): Signal[] =>
  SIGNAL_IDS.filter((id) => s[id] >= threshold).sort((a, b) => s[b] - s[a]);

/** The trusted-context block for the reviewer prompt. */
export function formatSignals(s: Signals): string {
  const line = (id: Signal) => `  ${id}: ${s[id].toFixed(2)}${s[id] >= SIGNAL_THRESHOLD ? "  ← flag" : ""}`;

  return ["Risk signals (Jev, calibrated probability that the answer is yes; advisory, never a gate):", ...SIGNAL_IDS.map(line)].join("\n");
}
