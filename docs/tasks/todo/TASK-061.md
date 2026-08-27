# TASK-061: Outstanding legal identity fields
## Priority: MEDIUM | Phase: V4 | Depends on: none
## Files allowed: lib/constants.ts
## Description
Two legal fields render conditionally and are currently blank.

  1. VAT number. The company is a registered VAT vendor; the number was
     mislaid. `STUDIO.legal.vatNumber` is ''. Once set it appears automatically
     in Terms section 6, the Terms section 29 contact block, and on invoices.
     A SA VAT number is 10 digits starting with 4 — a previously supplied
     9-digit number starting with 5 was rejected as invalid and never published.
  2. Information Officer name. POPIA requires a designated officer.
     `STUDIO.legal.informationOfficer.name` is '', so the privacy page renders
     a generic fallback.
## Acceptance criteria
- [ ] `STUDIO.legal.vatNumber` set to the real number, validated as 10 digits
      starting with 4
- [ ] `STUDIO.legal.informationOfficer.name` set
- [ ] /legal and /privacy render both without further code changes
