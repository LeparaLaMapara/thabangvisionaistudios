# TASK-036 — Gear Return Flow + Deposit Release

## Branch
feature/task-036-gear-return

## Mission
Close the rental lifecycle. Right now a renter can book gear and pay, but there's no structured way to return it, check condition, or release the deposit. This is a launch blocker — you can't hold deposits with no mechanism to give them back.

---

## What Already Exists

| Component | Status | Location |
|-----------|--------|----------|
| `equipment_bookings` table | Has `status`, `deposit_amount`, `total_price` | `supabase/migrations/20260311000000_base_schema.sql:201-219` |
| Booking status enum | `pending, confirmed, active, completed, cancelled, overdue` | Same migration |
| `smart_rentals` table | Has `condition` enum (`new, like_new, good, fair, for_parts`) | Same migration, lines 83-114 |
| Cart checkout | Creates bookings + payment via Paystack | `app/api/cart/checkout/route.ts` |
| Availability check | Checks date conflicts | `app/api/rentals/[id]/availability/route.ts` |
| Admin rentals page | List/create/update rentals | `app/(admin)/admin/rentals/page.tsx` |
| Paystack refunds | `refundPayment(reference, amount?)` | `lib/payments/paystack.ts:292-319` |
| Cloudinary uploads | Signed upload flow already works | `lib/storage/cloudinary.ts`, `lib/cloudinary/upload.ts` |

## What's Missing

- No return initiation route
- No condition check (before/after)
- No deposit release/deduction workflow
- No `returned_at`, `condition_at_checkout`, `condition_at_return`, `return_photos` columns
- No return confirmation from either party
- No overdue detection or late fee logic

---

## The Return Flow

### Who Does What

```
RENTER                          PLATFORM                        OWNER/ADMIN
───────                         ────────                        ───────────
Booking status: "active"
(renter has the gear)
        │
        ▼
Return date arrives
        │
        ▼
Clicks "Return Gear"           
on booking page                 
        │
        ▼
Uploads return photos ────────→ Stored in Cloudinary
(showing gear condition)        Linked to booking
        │
        ▼
Adds return notes ────────────→ Saved to booking
("All good, thanks")
        │
        ▼
Submits return ───────────────→ Status → "return_pending"
                                                                │
                                                                ▼
                                                    Owner/admin reviews:
                                                    - Return photos
                                                    - Condition comparison
                                                    - Original checkout condition
                                                                │
                                        ┌───────────────────────┼──────────────────┐
                                        ▼                       ▼                  ▼
                                   GOOD CONDITION          MINOR DAMAGE        MAJOR DAMAGE
                                        │                       │                  │
                                        ▼                       ▼                  ▼
                                   Full deposit            Partial deposit     No deposit
                                   released via            released, rest      Owner keeps deposit
                                   Paystack refund         kept as fee         Status → "disputed"
                                        │                       │              (see TASK-037)
                                        ▼                       ▼
                                   Status → "completed"    Status → "completed"
                                   Both parties notified   Both parties notified
```

---

## Database Changes

### Migration: Add return columns to `equipment_bookings`

```sql
-- Add return tracking columns
ALTER TABLE equipment_bookings
  ADD COLUMN IF NOT EXISTS condition_at_checkout TEXT 
    CHECK (condition_at_checkout IN ('new', 'like_new', 'good', 'fair', 'for_parts')),
  ADD COLUMN IF NOT EXISTS condition_at_return TEXT 
    CHECK (condition_at_return IN ('new', 'like_new', 'good', 'fair', 'for_parts')),
  ADD COLUMN IF NOT EXISTS return_photos JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS checkout_photos JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS return_notes TEXT,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_released NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS late_fee NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS return_reviewed_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS return_reviewed_at TIMESTAMPTZ;

-- Expand status enum to include return states
-- Current: 'pending', 'confirmed', 'active', 'completed', 'cancelled', 'overdue'
-- New: add 'return_pending', 'return_reviewed'
ALTER TABLE equipment_bookings
  DROP CONSTRAINT IF EXISTS equipment_bookings_status_check;
ALTER TABLE equipment_bookings
  ADD CONSTRAINT equipment_bookings_status_check
  CHECK (status IN (
    'pending', 'confirmed', 'active',
    'return_pending', 'return_reviewed', 'completed',
    'cancelled', 'overdue', 'disputed'
  ));
```

---

## API Routes

### `POST /api/rentals/[id]/return` — Renter initiates return

```
Auth: renter must own this booking
Input: {
  condition: 'new' | 'like_new' | 'good' | 'fair' | 'for_parts',
  photos: string[],        // Cloudinary URLs of return condition photos
  notes?: string
}
Actions:
  - Validate booking status is 'active' or 'overdue'
  - Save condition_at_return, return_photos, return_notes, returned_at
  - Update status → 'return_pending'
  - Calculate late_fee if return date > end_date
  - Notify owner/admin that return is pending review
Output: { success: true, booking }
```

### `POST /api/admin/rentals/[id]/review-return` — Admin reviews return

```
Auth: admin only
Input: {
  condition_accepted: boolean,
  deposit_action: 'full_release' | 'partial_release' | 'no_release' | 'dispute',
  deposit_release_amount?: number,    // For partial release
  admin_notes?: string
}
Actions:
  If deposit_action === 'full_release':
    - Call refundPayment(paystack_reference, deposit_amount)
    - Set deposit_released = deposit_amount
    - Status → 'completed'
  If deposit_action === 'partial_release':
    - Call refundPayment(paystack_reference, deposit_release_amount)
    - Set deposit_released = deposit_release_amount
    - Status → 'completed'
  If deposit_action === 'no_release':
    - deposit_released = 0
    - Status → 'completed'
  If deposit_action === 'dispute':
    - Status → 'disputed'
    - Create dispute record (see TASK-037)
  
  - Set return_reviewed_by, return_reviewed_at
  - Notify renter of outcome
  - Notify owner of outcome
Output: { success: true, booking, refund_result? }
```

### `POST /api/rentals/[id]/checkout-condition` — Record condition at pickup

```
Auth: admin or owner
Input: {
  condition: 'new' | 'like_new' | 'good' | 'fair',
  photos: string[]     // Cloudinary URLs of gear before handover
}
Actions:
  - Save condition_at_checkout, checkout_photos
  - Status → 'active' (gear is now with renter)
  - Notify renter that booking is active
Output: { success: true }
```

---

## Overdue Detection

Add to existing daily maintenance cron (`app/api/cron/daily-maintenance/route.ts`):

```typescript
// Mark overdue rentals
const { data: overdue } = await supabase
  .from('equipment_bookings')
  .update({ status: 'overdue', updated_at: new Date().toISOString() })
  .eq('status', 'active')
  .lt('end_date', today)
  .select();

// Notify renters with overdue gear
for (const booking of overdue ?? []) {
  await notify(booking.user_id, {
    type: 'rental_overdue',
    title: 'Your rental is overdue',
    body: `Please return your gear. Late fees may apply.`,
    link: `/dashboard/rentals/${booking.id}`,
  });
}
```

### Late Fee Calculation

```typescript
// In constants.ts
RENTAL: {
  depositPercent: 50,
  lateFeePerDay: 150,  // R150/day late fee (ZAR)
  maxLateDays: 14,     // After 14 days, escalate to dispute
}
```

---

## Frontend

### Renter's Booking Page — `/dashboard/rentals/[id]`

```
Status: Active
┌─────────────────────────────────────┐
│ Sony A7 III                         │
│ Booked: 12 Apr - 15 Apr 2026       │
│ Deposit: R750                       │
│ Status: Active                      │
│                                     │
│ [Return Gear]                       │
└─────────────────────────────────────┘

After clicking "Return Gear":
┌─────────────────────────────────────┐
│ Return Condition Check              │
│                                     │
│ Condition: [Good ▼]                 │
│                                     │
│ Upload photos of gear:              │
│ [📷 Drop photos here]              │
│                                     │
│ Notes (optional):                   │
│ [________________________]          │
│                                     │
│ [Submit Return]                     │
└─────────────────────────────────────┘
```

### Admin Return Review — `/admin/rentals/[id]/return`

```
┌─────────────────────────────────────────────────────┐
│ Return Review — Sony A7 III                         │
│ Renter: Thabo M.                                    │
│                                                     │
│ CHECKOUT CONDITION        RETURN CONDITION           │
│ ┌──────────┐              ┌──────────┐              │
│ │ [photo]  │  Like New    │ [photo]  │  Good        │
│ │ [photo]  │              │ [photo]  │              │
│ └──────────┘              └──────────┘              │
│                                                     │
│ Renter notes: "Small scratch on body, was there     │
│ when I picked it up"                                │
│                                                     │
│ Deposit: R750                                       │
│ Late fee: R0 (returned on time)                     │
│                                                     │
│ Decision:                                           │
│ (•) Full deposit release — R750                     │
│ ( ) Partial release — R[___]                        │
│ ( ) No release — keep full deposit                  │
│ ( ) Escalate to dispute                             │
│                                                     │
│ Admin notes: [________________________]             │
│                                                     │
│ [Confirm Decision]                                  │
└─────────────────────────────────────────────────────┘
```

---

## Notification Types to Add

```typescript
// Add to notification types
'rental_return_pending'   // → admin: "Thabo submitted a return for Sony A7 III"
'rental_return_approved'  // → renter: "Your deposit of R750 has been released"
'rental_return_partial'   // → renter: "R500 of your R750 deposit has been released"
'rental_overdue'          // → renter: "Your rental is overdue. Late fees apply."
'rental_completed'        // → owner: "Sony A7 III has been returned in good condition"
```

---

## The Full Rental Lifecycle

```
BROWSE → BOOK → PAY → PICKUP → USE → RETURN → REVIEW
  │        │      │      │       │       │        │
  │        │      │      │       │       │        └─ Reviews (DONE - exists)
  │        │      │      │       │       └─ THIS TASK
  │        │      │      │       └─ Status: active
  │        │      │      └─ Checkout condition recorded
  │        │      └─ Paystack payment (DONE - exists)
  │        └─ Cart checkout (DONE - exists)
  └─ Smart rentals browse (DONE - exists)
```

---

## Acceptance Criteria

- [ ] Renter can initiate return with condition + photos
- [ ] Admin can review return with before/after comparison
- [ ] Full deposit release triggers Paystack refund
- [ ] Partial deposit release triggers partial Paystack refund
- [ ] Overdue rentals auto-detected by daily cron
- [ ] Late fees calculated at R150/day (from constants.ts)
- [ ] Late fee constants in constants.ts, not hardcoded
- [ ] All status transitions validated (can't return a cancelled booking)
- [ ] Both parties notified at each step
- [ ] Checkout condition recorded with photos before handover
- [ ] Mobile-friendly return form (most renters use phones)
- [ ] Dispute escalation hands off to TASK-037 workflow

---

## Commit Strategy

1. `feat: add return columns to equipment_bookings migration`
2. `feat: checkout condition recording API + UI`
3. `feat: renter return submission API + UI`
4. `feat: admin return review with deposit release/refund`
5. `feat: overdue detection in daily maintenance cron`
6. `feat: return notification types + email alerts`

PR title: "TASK-036: Gear return flow with deposit release"
