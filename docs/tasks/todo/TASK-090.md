# TASK-090: Measure what Ubunye does for real customers
## Priority: MEDIUM | Status: planned | Added 2026-10-17

## Why
The eval sets prove behaviour on test sentences. The real proof is what
customers do next, and none of it is measured yet.

## What
- A small funnel from platform_events and the plan tables: chat started,
  outline shown, plan proposed, plan approved, People requests sent from a
  plan, requests accepted, gear ordered, paid.
- Per conversation: time to first word, steps, input tokens, cost.
- An admin view with the week's numbers, no personal details.
- Once traffic allows, change one thing at a time and compare before and
  after on these numbers (not on a feeling).
- Optional, owner's call: with personal details stripped, add real customer
  first messages to a NEW held-out set (never the tuning set).

## Done when
- The owner can see the funnel and cost per conversation for any week.
