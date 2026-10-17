# TASK-089: A grader for tone, honesty and helpfulness
## Priority: MEDIUM | Status: planned | Added 2026-10-17

## Why
The eval checks are simple text rules (right shoot type, first tool, no
unseen price, no long dash, says "not offered"). They cannot tell a warm,
clear, honest reply from a cold or confusing one.

## What
- A written marking scheme: grounded (every fact from a tool), honest about
  gaps, asks at most the questions needed, plain words, warm, tells the
  client the next step.
- A model grader that scores each reply against it, with its reason.
- Calibrate first: a person marks 40 to 60 replies by the same scheme; the
  grader is used only once it agrees with the person well (report the
  agreement). Re-check the agreement when the grader model changes.
- Add the grader scores to the eval summary and thresholds.

## Done when
- The eval reports a calibrated quality score per reply, with its agreement
  with human marks written down.
