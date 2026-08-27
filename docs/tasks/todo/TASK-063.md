# TASK-063: Add npm audit to the release routine
## Priority: MEDIUM | Phase: V4 | Depends on: none
## Files allowed: package.json, .github/workflows/, docs/processes/
## Description
On 2026-08-27 `npm audit` reported 12 vulnerabilities, 10 of them high,
including HTTP request smuggling in Next and CRLF injection in nodemailer.
Nine of the twelve were semver-compatible, meaning the fixes had been available
for some time and nobody was looking.

The check takes seconds. It should not depend on somebody remembering.
## Acceptance criteria
- [ ] `npm audit --audit-level=high` runs in CI, or as a documented pre-release step
- [ ] A high or critical finding fails the check rather than printing a warning
- [ ] Documented in docs/processes/ alongside the existing release steps
