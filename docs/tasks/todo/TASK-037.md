# TASK-037: Expand Rental Categories (Vehicles, Props, Wardrobe)

## Status: Todo

## Summary
Add new rental categories beyond camera/production equipment: sports cars, utility trucks, props, wardrobe, and potentially other production assets.

## Categories to Add
- **Sports Cars** — hero cars for film/commercial shoots
- **Utility Trucks** — production vehicles (crew transport, mobile units, grip trucks)
- **Props** — set dressing, furniture, period pieces, specialty items
- **Wardrobe** — costumes, styling pieces, accessories

## Technical Considerations

### Pricing Models
Current equipment rentals use a flat daily rate + deposit. New categories may need:
- **Vehicles**: per-day + mileage cap, insurance tier (basic vs. comprehensive), driver included vs. self-drive, fuel policy
- **Props**: per-day or per-project, bulk discounts for large set-dressing orders
- **Wardrobe**: per-day, dry-cleaning deposit, damage waiver

### Schema Changes
- Add new values to category validation (constants.ts `RENTAL_CATEGORIES`)
- Consider `smart_rentals` schema additions: `insurance_required`, `delivery_available`, `pickup_location`, `vehicle_mileage_cap`
- Category-specific metadata fields (vehicle: make/model/year, props: period/era, wardrobe: size/gender)

### Business Requirements
- Insurance and liability: vehicles need higher coverage than camera gear
- Delivery logistics: large items (vehicles, furniture) need delivery/pickup coordination
- Verification: vehicle owners may need additional verification (registration, insurance proof)
- Damage assessment: photo-based condition reports before/after rental

### UI Changes
- New category cards with appropriate imagery in `RENTAL_CATEGORIES` and `PLACEHOLDER_IMAGES`
- Category-specific filter/sort options (e.g., vehicle type, prop era, wardrobe size)
- Possibly a different detail view layout for vehicles vs. small equipment

## Out of Scope (for now)
- Location/studio space rentals (different business model entirely)
- Crew/talent booking (handled by Smart Productions)

## Priority
Low — exploratory. Validate demand before building.
