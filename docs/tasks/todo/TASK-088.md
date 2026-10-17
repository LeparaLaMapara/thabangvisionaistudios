# TASK-088: Prompt caching and parallel searches for Ubunye
## Priority: HIGH | Status: planned | Added 2026-10-17

## Why
Every Ubunye message sends the whole system prompt with the live catalogue:
about 30 000 input tokens a call on the test site (ai_token_usage,
2026-10-17). Nothing is cached (no cacheControl anywhere in lib/). A full
plan can take 5 model steps one after another (plan_outline, then each
find_people and search_gear, then propose_plan).

## What
- Put the stable part of the prompt first and mark it cacheable for the
  providers that support it (Anthropic cache_control; Gemini implicit or
  explicit context caching); keep the per-user and per-day lines after it.
- Move the catalogue out of the prompt where a tool already returns it
  (search_gear, find_people), so the prompt shrinks.
- Let the model call independent searches in the same step (parallel tool
  calls), and measure steps per plan.
- Measure before and after: input tokens per message, cost per conversation,
  time to first word, with the eval set as the check that quality held.

## Done when
- Input tokens per message and time to first word are measured and lower,
  and the eval scores are unchanged or better.
