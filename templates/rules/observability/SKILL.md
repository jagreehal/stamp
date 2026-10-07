---
name: observability
description: Observability rules for a code review. Flags new code that production cannot see or that leaks through telemetry. Covers outbound calls without a span or log, errors that lose their cause, unstructured logs, secrets or personal data in logs and spans, silent data drops, unbounded labels, and user-facing changes with no signal. Use as a review lens or as a stamp rule pack.
---

# observability

Production is where this code will fail. Review whether an on-call engineer
could see it fail, find the request, and know why, without the telemetry itself
leaking data or cost.

## Review

- **boundary-signal**: A new call that leaves the process (HTTP, database, queue, model API, file or shell) runs inside the repository's tracing or logging helper. Flag: an outbound call with no span or log around it. Why: an outage there is invisible.
- **error-context**: A caught or rethrown error keeps its cause and the identifiers that find the request: ids, never payloads. Flag: an empty `catch`, a rethrow of a bare message, a log of `error.message` without the error. Why: the trail ends at the catch.
- **structured-logs**: Server code logs through the repository's structured logger with fields. Flag: interpolated log strings, `console.log` in server code, a second logger. Why: nobody can search or alert on prose.
- **no-sensitive-data**: Logs, span attributes and events carry no secrets, tokens, passwords, whole request bodies or personal data. Flag: logging a whole object built from user input, headers or credentials. Why: telemetry becomes the leak.
- **silent-drop**: Code that skips, filters or discards records, gives up on a retry, or falls back counts or logs what it dropped. Flag: a `continue` or default branch that loses data without a trace. Why: data loss nobody notices.
- **bounded-attributes**: Span names, span attributes and metric labels take bounded values. Flag: user ids, ids inside URLs, free text or raw input as a metric label or span name. Why: cardinality blows up cost and queries.
- **feature-signal**: A change meant to move a user outcome emits the event or metric that shows whether it did. Flag: a new user-facing flow with no event or metric. Why: no one can tell it works.

## Fix

- Prefer: the repository's existing logger, tracer and metrics helpers, found in code next to the change.
- Never touch: telemetry configuration, exporters, sampling or vendor setup.
- Escalate: adding a logging, tracing or metrics dependency or vendor, and any rule where the repository has no logger or tracer yet.
