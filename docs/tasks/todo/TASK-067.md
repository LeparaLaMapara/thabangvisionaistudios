# TASK-067: Protect gear the Apple way (make theft pointless, check by value)
## Priority: HIGH | Phase: V5 | Depends on: TASK-068 (ID check redesign)
## Files allowed: lib/rental/, lib/verification/, app/(platform)/rentals/, app/(platform)/dashboard/, app/api/bookings/, app/api/cart/, lib/constants.ts, supabase/migrations/
## Description
Owner's concern (2026-09-27): someone can rent a camera and disappear. Apple's
answer to phone theft was Activation Lock: make a stolen phone worthless, and
keep the security invisible to honest people. Apply the same:

1. **Make a stolen camera worthless.** Record each item's serial number
   (`smart_rentals.serial_number`), a hidden tracker per kit bag (AirTag or
   similar), and a line on every listing: "All ThabangVision gear is
   serial-registered and tracked." On theft: SAPS case with the serial number;
   second-hand dealers must check serials under the Second-Hand Goods Act.
2. **A trust ladder instead of one heavy gate.** First rental up to a value
   limit (default R5 000, a setting) needs ID photo + live selfie, a phone OTP,
   and payment from a card/account in the renter's own name. Limits rise after
   clean returns (for example R20 000 after two). High-value kit: collection
   only, a second contact, larger deposit.
3. **Handover like Apple pickup.** First and high-value rentals are collection
   only. At handover staff check the ID against the selfie, take condition
   photos and a photo of the renter with the gear, and the renter signs on
   screen (stored with the booking).
4. **Money and agreement stated up front.** Deposit scales with gear value; a
   published damage fee table (AppleCare-style fixed fees); the rental
   agreement signed with the ID number states non-return is theft by conversion.

## Acceptance criteria
- [ ] Renter limit per tier enforced in availability/checkout, with the limit
      and the reason shown before payment
- [ ] Serial number on every listing (admin), tracker flag, listing line shown
- [ ] Handover screen for staff: ID match, condition photos, signature, saved to the booking
- [ ] Damage fee table and agreement text generated from one config source
- [ ] Tests for the tier rules
