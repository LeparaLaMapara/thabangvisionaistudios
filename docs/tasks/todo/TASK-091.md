# TASK-091: Ubunye reliability leftovers
## Priority: MEDIUM | Status: planned | Added 2026-10-17

## Why
Small gaps found while building plans and the eval.

## What
- Invariant sweep for stuck proposals: agent_actions left in "committing"
  past a few minutes are reported (and, where safe, failed), so a half-done
  approval never hangs silently. Hook into the daily checks.
- The word "available" about people: a stream filter like
  lib/ai/plain-dashes.ts for "N photographers available" style phrases,
  instead of relying on the prompt alone (it still slips).
- One-person asks (proposal shoot, staff headshots, a social content day)
  sometimes get plan_outline before find_people: harmless, read-only, but a
  step longer. Look at why from the eval rows; fix in the prompt or the
  outline tool, then confirm on the tuning set, never the held-out set.
- The eval's per-minute retry and cookie refresh are in the runner; add a
  test for the runner's scoring (wilson, thresholds) so it cannot drift.

## Done when
- Stuck proposals show in the daily checks, the "available" slip is filtered,
  and one-person asks go straight to find_people on the tuning set.
