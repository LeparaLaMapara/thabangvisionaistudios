# TASK-080: Gear insurance per rental
## Priority: LOW | Added by the owner on 2026-10-13 | Needs owner decision on money
## Files allowed: none until a partner is chosen
## Related: TASK-072 (gear check), migration 062 (gear protection)

## Why
Expensive gear is the biggest risk for owners and renters. Cover per rental
lets renters take gear without a huge deposit and lets owners list more.

## Plan
1. Research South African insurers that offer per-day equipment cover
   through an API or a partner deal; compare price, excess, claims process.
2. Offer cover at checkout as a line item; the gear check (TASK-072) is
   the claim evidence.
3. Decide with the owner how cover and the existing deposit interact.

## Rules
Touches payments and deposits: no build without the owner's explicit approval.
Insurance selling may need FSCA licensing; the partner must hold it, not us.
