# TASK-087: Know which model answered, and test every backup model
## Priority: HIGH | Status: planned | Added 2026-10-17

## Why
Ubunye streams from one model and switches to a backup provider when the
first fails (lib/ai/resilient-stream.ts). A backup may behave differently
(tools, wording, honesty). On 2026-10-17 every eval answer, on the test site
and on production, came from gemini-3.6-flash (ai_token_usage), not the
Claude model CLAUDE.md names. Nobody had noticed, because the eval does not
record the model.

## What
- The eval records the served model per run (the stream's onServed already
  knows it; expose it to the eval only, e.g. a `data-model` part or a header
  read after the stream, or read ai_token_usage for the eval account).
- The eval summary groups scores by model.
- A nightly job runs the tuning set against each tool-calling model in the
  chain (forced with the registry ref), so a backup that fails the bar is
  known before it ever serves a customer.
- Decide, with the owner, which model is meant to be first, and update
  CLAUDE.md to match what runs.

## Done when
- Every eval run says which model answered, and the nightly report shows a
  score per model in the chain.
