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

- Found on 2026-10-17 (production copy and held-out baseline):
  - The plan approval card prints a past "do by" date plainly ("do by
    Saturday 3 October" for a shoot on the 24th). The plan page already says
    "Do this now (it was due by ...)"; the card should say the same.
  - Totals are worked out by the model ("R4 800 for 2 lights, 3 days"). They
    were right, but money sums should come from code (a quote tool), not the
    model. The eval counts these separately as "worked out by the model".
  - The model once called its own prompt "our sample catalogue". Say "our
    rentals" and link the category.
  - Shoot type recognition: phrasings the keyword matcher has never seen fall
    back to "general" (a Nikah, umbondo, a company profile video). Principled
    fix, not tuning to the held-out set: plan_outline takes the model's own
    choice of type from the fixed list (an enum in the tool schema) and uses
    keywords only as the fallback and the check. Measure on the held-out set
    once, after the change.

- The "Your shoot" card and the People swipe row vanish after a page reload
  (chat cards are stored for People results, not for plan_outline). Store a
  blind outline card in lib/ubunye/chat-cards.ts and restore it.
- After the 2026-10-17 shoot-type fix the held-out score rose to 90% (81 to
  95) from 74%; raise the holdout minimums in tests/eval/thresholds.json once
  two nightly runs confirm it.

## Done when
- Stuck proposals show in the daily checks, the "available" slip is filtered,
  and one-person asks go straight to find_people on the tuning set.
