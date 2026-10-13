# TASK-076: Shoot-day plan and call sheet
## Priority: MEDIUM | Added by the owner on 2026-10-13
## Files allowed: new lib/callsheet/*, app/dashboard/bookings/*, a new migration
## Depends on: TASK-074 (crew call), TASK-073 (locations)

## Why
Once a shoot or crew is booked, everyone needs the same plan: when, where, who,
what to bring. Today that lives in WhatsApp.

## Plan
1. Call sheet generated from the booking: call times per person, location
   pin and directions, parking, contacts, gear list (with who brings what).
2. Conditions for that day and place: weather, sunrise, sunset, golden hour,
   and power cut times for the area.
3. Share as a link and PDF; reminders the day before and on the morning.
4. Changes notify everyone and keep a version history.

## Open questions
- Power cut data source: EskomSePush API needs a licence for business use;
  check terms and cost before building. Municipal schedules are a fallback.
- Weather: a free API (e.g. Open-Meteo) is enough.
