# TASK-037 — Dispute Resolution Workflow

## Branch
feature/task-037-disputes

## Mission
Build a structured dispute resolution flow so that when gear comes back damaged, a creator no-shows, or a client cancels unfairly, there's a clear path from claim to resolution. Without this, every dispute becomes a manual admin firefight with no record trail.

---

## What Already Exists

| Component | Status | Location |
|-----------|--------|----------|
| `bookings` table has `status = 'disputed'` | Enum value exists | `supabase/migrations/20260312000014_booking_system.sql:44-46` |
| `dispute_reason` column on bookings | Column exists, unused | Same migration, line 61 |
| `disputed_at` column on bookings | Column exists, unused | Same migration, line 59 |
| `refundPayment(reference, amount?)` | Full + partial refunds via Paystack | `lib/payments/paystack.ts:292-319` |
| Admin booking management | Can cancel + auto-refund | `app/api/admin/service-bookings/[id]/route.ts` |
| Cancellation policy | Full >48hrs, 50% late | `docs/processes/client-payment-process.md:629-681` |
| Email notifications | Gmail provider works | `lib/email/gmail.ts` |
| Reviews table | Supports `rental` type reviews | `supabase/migrations/20260322000019_consolidate_reviews.sql` |

## What's Missing

- No dedicated `disputes` table (just a status flag + reason on bookings)
- No damage claim form or evidence upload
- No dispute lifecycle (open → investigating → resolved)
- No admin dispute review UI
- No dispute history/timeline
- No resolution options (refund, partial refund, deposit forfeit, warning)
- No escalation rules
- `equipment_bookings` has no dispute columns at all

---

## Dispute Types

| Type | Trigger | Who Files | Example |
|------|---------|-----------|---------|
| **Gear Damage** | Gear returned damaged | Owner/Admin | "Lens has scratches that weren't there at checkout" |
| **Gear Not Returned** | Overdue > 14 days | Auto/Admin | Renter hasn't returned after max late period |
| **Creator No-Show** | Creator didn't show up | Client | "Booked photographer didn't arrive" |
| **Client Cancellation** | Late cancel, disputes fee | Client | "I was charged 50% but had an emergency" |
| **Quality Dispute** | Work didn't match agreement | Client | "Photos are unusable, not what was agreed" |
| **Payment Dispute** | Payout amount wrong | Creator | "I should have been paid R5,000 not R4,200" |

---

## Database Changes

### New table: `disputes`

```sql
CREATE TABLE IF NOT EXISTS disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What's being disputed
  dispute_type TEXT NOT NULL CHECK (dispute_type IN (
    'gear_damage', 'gear_not_returned', 'creator_no_show',
    'client_cancellation', 'quality_dispute', 'payment_dispute'
  )),

  -- Link to the booking (one or the other, not both)
  booking_id UUID REFERENCES bookings(id),
  equipment_booking_id UUID REFERENCES equipment_bookings(id),

  -- Who filed it
  filed_by UUID NOT NULL REFERENCES profiles(id),
  filed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Dispute details
  reason TEXT NOT NULL,
  evidence_photos JSONB DEFAULT '[]',     -- Cloudinary URLs
  evidence_notes TEXT,

  -- Resolution
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'investigating', 'resolved', 'escalated', 'dismissed'
  )),
  resolution TEXT CHECK (resolution IN (
    'full_refund', 'partial_refund', 'deposit_forfeit',
    'warning_issued', 'user_suspended', 'no_action', 'custom'
  )),
  resolution_amount NUMERIC,              -- Refund/compensation amount if applicable
  resolution_notes TEXT,
  resolved_by UUID REFERENCES profiles(id),
  resolved_at TIMESTAMPTZ,

  -- Timeline
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_disputes_filed_by ON disputes(filed_by);
CREATE INDEX idx_disputes_booking ON disputes(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX idx_disputes_equipment ON disputes(equipment_booking_id) WHERE equipment_booking_id IS NOT NULL;

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

-- Dispute timeline/comments
CREATE TABLE IF NOT EXISTS dispute_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id),
  comment TEXT NOT NULL,
  attachments JSONB DEFAULT '[]',
  is_internal BOOLEAN DEFAULT false,      -- Admin-only notes not visible to users
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dispute_comments_dispute ON dispute_comments(dispute_id);
```

### Add dispute columns to `equipment_bookings`

```sql
ALTER TABLE equipment_bookings
  ADD COLUMN IF NOT EXISTS dispute_reason TEXT,
  ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ;
```

(The `bookings` table already has these columns.)

---

## The Dispute Flow

```
INCIDENT HAPPENS
    │
    ▼
User clicks "Report Issue" on booking page
    │
    ▼
┌─────────────────────────────────┐
│ DISPUTE FORM                    │
│                                 │
│ Type: [Gear Damage ▼]          │
│                                 │
│ What happened:                  │
│ [_____________________________] │
│                                 │
│ Evidence photos:                │
│ [📷 Upload]                    │
│                                 │
│ [Submit Dispute]                │
└─────────────────────────────────┘
    │
    ▼
Status: OPEN
Both parties notified
Admin notified via email
    │
    ▼
┌─────────────────────────────────┐
│ ADMIN REVIEWS                   │
│                                 │
│ - Reads both sides              │
│ - Views evidence photos         │
│ - Compares checkout vs return   │
│   photos (gear disputes)        │
│ - Adds internal notes           │
│ - May request more info from    │
│   either party                  │
│                                 │
│ Status: INVESTIGATING           │
└─────────────────────────────────┘
    │
    ▼
ADMIN RESOLVES
    │
    ├─→ Full refund         → Paystack refundPayment()
    ├─→ Partial refund      → Paystack refundPayment(ref, amount)
    ├─→ Deposit forfeit     → No refund, owner keeps deposit
    ├─→ Warning issued      → Flag on user profile
    ├─→ User suspended      → See TASK-038
    ├─→ No action           → Dismissed with explanation
    └─→ Custom              → Admin writes custom resolution
    │
    ▼
Status: RESOLVED
Both parties notified of outcome
Resolution recorded with timestamp
```

---

## API Routes

### `POST /api/disputes` — File a dispute

```
Auth: authenticated user who is party to the booking
Input: {
  dispute_type: string,
  booking_id?: string,           // For service bookings
  equipment_booking_id?: string, // For gear rentals
  reason: string,
  evidence_photos?: string[],
  evidence_notes?: string
}
Validation:
  - User must be renter, owner, client, or creator on the booking
  - Booking must be in a disputable state (active, completed, return_pending, overdue)
  - No duplicate open disputes for same booking
Actions:
  - Create dispute record
  - Update booking status → 'disputed'
  - Notify other party
  - Notify admin via email
Output: { success: true, dispute }
```

### `GET /api/disputes/[id]` — Get dispute details

```
Auth: filed_by user, other party, or admin
Output: dispute + comments timeline
```

### `POST /api/disputes/[id]/comment` — Add comment to dispute

```
Auth: either party or admin
Input: { comment: string, attachments?: string[] }
Admin can mark as is_internal (not visible to users)
```

### `PATCH /api/admin/disputes/[id]` — Admin updates dispute

```
Auth: admin only
Input: {
  status?: 'investigating' | 'resolved' | 'escalated' | 'dismissed',
  resolution?: string,
  resolution_amount?: number,
  resolution_notes?: string
}
Actions:
  If resolution involves refund → call refundPayment()
  If resolution is 'user_suspended' → see TASK-038
  Update dispute record
  Notify both parties of outcome
Output: { success: true, dispute, refund_result? }
```

### `GET /api/admin/disputes` — List all disputes

```
Auth: admin only
Query: ?status=open&type=gear_damage&page=1
Output: paginated disputes with booking details
```

---

## Frontend

### User: Report Issue Button

On every active/completed booking page (`/dashboard/rentals/[id]` and `/dashboard/bookings/[id]`):

```
[Report Issue] button → opens dispute form modal
```

### User: Dispute Detail Page — `/dashboard/disputes/[id]`

```
┌─────────────────────────────────────┐
│ Dispute #D-001                      │
│ Type: Gear Damage                   │
│ Status: Investigating               │
│ Filed: 15 Apr 2026                  │
│                                     │
│ Booking: Sony A7 III (12-15 Apr)    │
│                                     │
│ TIMELINE:                           │
│ ─────────                           │
│ 15 Apr — You filed this dispute     │
│ "Lens has scratches..."             │
│ [photo] [photo]                     │
│                                     │
│ 15 Apr — Admin is reviewing         │
│ "We're looking into this."          │
│                                     │
│ 16 Apr — Admin requested more info  │
│ "Can you provide a closer photo?"   │
│                                     │
│ [Add Comment] [Upload Photo]        │
└─────────────────────────────────────┘
```

### Admin: Disputes Dashboard — `/admin/disputes`

```
┌──────────────────────────────────────────────────────────┐
│ Disputes                                                  │
│                                                           │
│ [Open (3)] [Investigating (1)] [Resolved] [All]          │
│                                                           │
│ ┌────────────────────────────────────────────────────┐   │
│ │ #D-003  Gear Damage    Open     15 Apr 2026        │   │
│ │ Thabo M. → Sony A7 III rental                      │   │
│ │ "Lens returned with scratches"                      │   │
│ │ [Review →]                                          │   │
│ ├────────────────────────────────────────────────────┤   │
│ │ #D-002  Creator No-Show  Open   14 Apr 2026        │   │
│ │ Brand X → Wedding shoot booking                     │   │
│ │ "Photographer didn't arrive"                        │   │
│ │ [Review →]                                          │   │
│ └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### Admin: Resolve Dispute — `/admin/disputes/[id]`

```
┌─────────────────────────────────────────────────────┐
│ Resolve Dispute #D-003                              │
│                                                     │
│ [Full timeline + evidence visible]                  │
│                                                     │
│ CHECKOUT PHOTOS        RETURN PHOTOS                │
│ [photo] [photo]        [photo] [photo]              │
│ Condition: Like New    Condition: Fair               │
│                                                     │
│ Resolution:                                         │
│ ( ) Full refund — R750                              │
│ (•) Partial refund — R[375]                         │
│ ( ) Deposit forfeit — owner keeps R750              │
│ ( ) Warning issued                                  │
│ ( ) Suspend user (→ TASK-038)                       │
│ ( ) No action / dismiss                             │
│                                                     │
│ Notes to both parties:                              │
│ [_______________________________________]           │
│                                                     │
│ Internal notes (admin only):                        │
│ [_______________________________________]           │
│                                                     │
│ [Resolve Dispute]                                   │
└─────────────────────────────────────────────────────┘
```

---

## Auto-Escalation Rules

Add to daily maintenance cron:

```typescript
// Auto-escalate gear not returned after 14 days
const { data: unreturned } = await supabase
  .from('equipment_bookings')
  .select('*')
  .eq('status', 'overdue')
  .lt('end_date', fourteenDaysAgo);

for (const booking of unreturned ?? []) {
  // Check if dispute already exists
  const { data: existing } = await supabase
    .from('disputes')
    .select('id')
    .eq('equipment_booking_id', booking.id)
    .eq('dispute_type', 'gear_not_returned')
    .single();

  if (!existing) {
    // Auto-create dispute
    await supabase.from('disputes').insert({
      dispute_type: 'gear_not_returned',
      equipment_booking_id: booking.id,
      filed_by: booking.rental_owner_id, // or admin
      reason: `Gear not returned. ${daysSinceEnd} days overdue.`,
      status: 'open',
    });
    // Notify admin
    await sendAdminAlert('Gear not returned — auto-dispute created', booking);
  }
}
```

---

## Notification Types to Add

```typescript
'dispute_filed'           // → other party + admin: "A dispute has been filed"
'dispute_comment'         // → other party: "New message on dispute #D-003"
'dispute_investigating'   // → both parties: "Admin is reviewing your dispute"
'dispute_resolved'        // → both parties: "Dispute resolved — [outcome]"
'dispute_escalated'       // → admin: "Dispute auto-escalated (gear not returned 14+ days)"
```

---

## Acceptance Criteria

- [ ] Users can file disputes from booking pages with evidence photos
- [ ] Dispute types cover: gear damage, not returned, no-show, cancellation, quality, payment
- [ ] Admin sees all disputes in a filterable dashboard
- [ ] Admin can resolve with: full refund, partial refund, deposit forfeit, warning, suspend, dismiss
- [ ] Refund resolutions trigger Paystack refundPayment()
- [ ] Timeline shows full conversation between parties + admin
- [ ] Internal admin notes not visible to users
- [ ] Gear not returned > 14 days auto-creates dispute
- [ ] Both parties notified at every status change
- [ ] No duplicate disputes for the same booking
- [ ] Dispute links to TASK-036 return flow (gear damage disputes reference checkout vs return photos)
- [ ] Dispute links to TASK-038 (user suspension as a resolution option)

---

## Dependencies

- **TASK-036** (Gear Return) — checkout/return photos are evidence in gear damage disputes
- **TASK-038** (User Suspension) — "suspend user" is a dispute resolution option

---

## Commit Strategy

1. `feat: disputes + dispute_comments tables migration`
2. `feat: file dispute API + user dispute form`
3. `feat: dispute timeline with comments API`
4. `feat: admin disputes dashboard + resolve UI`
5. `feat: auto-escalation for unreturned gear in daily cron`
6. `feat: dispute notification types + email alerts`

PR title: "TASK-037: Dispute resolution workflow"
