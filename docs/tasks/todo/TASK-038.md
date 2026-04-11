# TASK-038 — User Suspension & Admin Moderation

## Branch
feature/task-038-user-moderation

## Mission
Give admins the ability to suspend bad actors. Right now you can verify users and change roles, but you can't stop someone from transacting after they've damaged gear, filed fake disputes, or violated platform rules. One toggle and a reason — that's the minimum.

---

## What Already Exists

| Component | Status | Location |
|-----------|--------|----------|
| Role system: `user`, `admin`, `moderator` | Works | `supabase/migrations/20260312000005_admin_roles.sql` |
| Admin users page | Lists users, changes roles | `app/(admin)/admin/users/page.tsx` |
| Admin users API | GET list, PATCH role | `app/api/admin/users/route.ts` |
| ID verification review | Admin reviews submitted IDs | `app/(admin)/admin/verifications/page.tsx` |
| Fraud detection columns | `verification_fraud_flags`, `id_document_hash`, IP, user agent | `supabase/migrations/20260312000008_verification_redesign.sql` |
| Auth middleware | Checks session + admin email | `lib/auth/` |
| ADMIN_EMAILS | Controls admin access | `lib/constants.ts` |

## What's Missing

- No `is_suspended` or `suspended_at` column on profiles
- No suspension reason tracking
- No suspension UI for admins
- No enforcement — suspended users can still log in, book, list
- No suspension history / audit log
- No appeal or reinstatement process
- No automated suspension triggers
- No listing deactivation when user is suspended

---

## Database Changes

### Migration: Add suspension columns to `profiles`

```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
  ADD COLUMN IF NOT EXISTS suspension_expires_at TIMESTAMPTZ;  -- null = permanent

CREATE INDEX idx_profiles_suspended ON profiles(is_suspended) WHERE is_suspended = true;
```

### New table: `moderation_log`

```sql
CREATE TABLE IF NOT EXISTS moderation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL CHECK (action IN (
    'suspended', 'reinstated', 'warning_issued', 'listing_removed', 'verification_rejected'
  )),
  reason TEXT NOT NULL,
  admin_id UUID NOT NULL REFERENCES profiles(id),
  dispute_id UUID REFERENCES disputes(id),    -- Optional link to dispute
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_moderation_log_user ON moderation_log(user_id);
CREATE INDEX idx_moderation_log_action ON moderation_log(action);
```

---

## What Suspension Blocks

When `is_suspended = true`, the user CANNOT:

| Action | Where enforced |
|--------|----------------|
| Book gear | `POST /api/cart/checkout` — check `is_suspended` |
| Book a creator | `POST /api/service-bookings` — check `is_suspended` |
| List gear for rent | `POST /api/rentals` — check `is_suspended` |
| Accept bookings | `PATCH /api/service-bookings/[id]` — check `is_suspended` |
| Chat with Ubunye Booking | Agent runtime — check `is_suspended` |
| Upload to portfolio | `POST /api/agents/portfolios` — check `is_suspended` |

When `is_suspended = true`, the user CAN:

| Action | Why |
|--------|-----|
| Log in | So they can see the suspension notice and contact support |
| View the suspension reason | Transparency |
| View their booking history | Their data is still theirs |
| File an appeal (future) | Fair process |

### Enforcement Helper

```typescript
// lib/auth/index.ts — add to existing auth helpers

export async function checkNotSuspended(userId: string): Promise<{
  suspended: boolean;
  reason?: string;
}> {
  const { data } = await supabase
    .from('profiles')
    .select('is_suspended, suspension_reason, suspension_expires_at')
    .eq('id', userId)
    .single();

  if (!data?.is_suspended) return { suspended: false };

  // Check if suspension has expired
  if (data.suspension_expires_at && new Date(data.suspension_expires_at) < new Date()) {
    // Auto-reinstate
    await supabase.from('profiles')
      .update({ is_suspended: false, suspended_at: null, suspension_reason: null })
      .eq('id', userId);
    return { suspended: false };
  }

  return { suspended: true, reason: data.suspension_reason };
}
```

### Usage in API Routes

```typescript
// Example: cart checkout
const { suspended, reason } = await checkNotSuspended(user.id);
if (suspended) {
  return NextResponse.json(
    { error: 'Account suspended', reason },
    { status: 403 }
  );
}
```

---

## Suspension Triggers

### Manual (admin action)
- Admin clicks "Suspend" on user management page
- Admin resolves dispute with "suspend user" resolution (TASK-037)
- Admin rejects verification and decides to suspend

### Automatic (future, rules-based)
These are stretch goals, not launch requirements:

```
Rule: 3+ disputes filed against user → auto-flag for review
Rule: Gear overdue > 30 days → auto-suspend
Rule: 3+ rejected verifications → auto-suspend
Rule: Verified fraud flags → auto-suspend
```

For launch, only manual suspension is needed.

---

## API Routes

### `POST /api/admin/users/[id]/suspend` — Suspend a user

```
Auth: admin only
Input: {
  reason: string,
  expires_at?: string,     // ISO date, null = permanent
  dispute_id?: string      // Optional link to dispute that triggered this
}
Actions:
  - Set is_suspended = true, suspended_at, suspended_by, suspension_reason
  - Deactivate all active listings (is_published = false, is_available = false)
  - Cancel all pending/confirmed bookings (both as renter and creator)
  - Notify user via email: "Your account has been suspended. Reason: ..."
  - Log to moderation_log
Output: { success: true, affected_listings, affected_bookings }
```

### `POST /api/admin/users/[id]/reinstate` — Reinstate a user

```
Auth: admin only
Input: {
  reason: string          // Why they're being reinstated
}
Actions:
  - Set is_suspended = false, clear suspension fields
  - DO NOT auto-reactivate listings (user should review and republish)
  - Notify user via email: "Your account has been reinstated"
  - Log to moderation_log
Output: { success: true }
```

### `GET /api/admin/users/[id]/moderation-log` — View user's moderation history

```
Auth: admin only
Output: [{ action, reason, admin, dispute_id, created_at }]
```

---

## Frontend

### Admin Users Page — Add Suspension Controls

Update existing `/admin/users` page:

```
┌──────────────────────────────────────────────────────────────┐
│ Users                                                         │
│                                                               │
│ [All] [Active] [Suspended (2)] [Unverified]                 │
│                                                               │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 🔴 Thabo M.     thabo@email.com     SUSPENDED            │ │
│ │ Role: User      Suspended: 15 Apr 2026                   │ │
│ │ Reason: "Gear returned damaged, 2nd offense"             │ │
│ │ [View History] [Reinstate]                               │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ 🟢 Sarah K.     sarah@email.com     ACTIVE               │ │
│ │ Role: User      Verified: 10 Mar 2026                    │ │
│ │ [View History] [Suspend]                                 │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Suspend Modal

```
┌─────────────────────────────────────┐
│ Suspend Thabo M.                    │
│                                     │
│ Reason (required):                  │
│ [_________________________________] │
│                                     │
│ Duration:                           │
│ (•) Permanent                       │
│ ( ) 7 days                          │
│ ( ) 30 days                         │
│ ( ) Custom: [____]                  │
│                                     │
│ This will:                          │
│ • Deactivate all their listings     │
│ • Cancel pending bookings           │
│ • Block new transactions            │
│ • Notify them via email             │
│                                     │
│ [Cancel]  [Confirm Suspension]      │
└─────────────────────────────────────┘
```

### Suspended User Experience

When a suspended user logs in, they see a banner on every page:

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠ Your account has been suspended.                           │
│ Reason: "Gear returned damaged, 2nd offense"                 │
│ You can view your history but cannot make new transactions.  │
│ Contact support@thabangvision.co.za to appeal.               │
└──────────────────────────────────────────────────────────────┘
```

### Moderation History

On admin user detail page:

```
┌─────────────────────────────────────┐
│ Moderation History — Thabo M.       │
│                                     │
│ 15 Apr 2026 — SUSPENDED             │
│ By: Admin                           │
│ Reason: "Gear returned damaged"     │
│ Linked to: Dispute #D-003           │
│                                     │
│ 02 Mar 2026 — WARNING ISSUED        │
│ By: Admin                           │
│ Reason: "Late return, first offense"│
│                                     │
│ 15 Feb 2026 — VERIFICATION REJECTED │
│ By: Admin                           │
│ Reason: "Blurry ID photo"           │
└─────────────────────────────────────┘
```

---

## Side Effects of Suspension

When a user is suspended, the system must handle their active state:

```
User suspended
    │
    ├─→ All published listings → is_published = false
    │   (gear disappears from marketplace)
    │
    ├─→ All pending equipment_bookings (as renter) → cancelled
    │   (deposits refunded via Paystack)
    │
    ├─→ All pending bookings (as creator) → unassigned
    │   (reassigned to another creator or cancelled)
    │
    ├─→ Active rentals → flagged for admin
    │   (can't cancel mid-rental, admin must handle)
    │
    └─→ Email sent to user with reason + contact info
```

---

## Notification Types to Add

```typescript
'account_suspended'    // → user: "Your account has been suspended. Reason: ..."
'account_reinstated'   // → user: "Your account has been reinstated"
'moderation_warning'   // → user: "A warning has been issued on your account"
```

---

## Acceptance Criteria

- [ ] Admin can suspend a user with reason (permanent or timed)
- [ ] Admin can reinstate a suspended user
- [ ] Suspended users cannot: book gear, book creators, list gear, accept bookings
- [ ] Suspended users can: log in, view history, see suspension reason
- [ ] All active listings deactivated on suspension
- [ ] Pending bookings cancelled/refunded on suspension
- [ ] Moderation log records all admin actions with timestamps
- [ ] Suspension banner shown to suspended users on every page
- [ ] Timed suspensions auto-expire (checked in `checkNotSuspended()`)
- [ ] Admin users page shows suspension status with filter
- [ ] Email notification sent on suspend and reinstate
- [ ] `checkNotSuspended()` helper available for all API routes
- [ ] Dispute resolution can trigger suspension (links to TASK-037)
- [ ] Suspension constants (contact email) from constants.ts

---

## Dependencies

- **TASK-037** (Disputes) — "suspend user" is a dispute resolution option
- None for launch — this can be built independently

---

## Commit Strategy

1. `feat: add suspension columns to profiles + moderation_log table`
2. `feat: checkNotSuspended() auth helper + enforce in API routes`
3. `feat: admin suspend/reinstate API routes`
4. `feat: admin users page — suspension UI + moderation history`
5. `feat: suspension side effects (deactivate listings, cancel bookings)`
6. `feat: suspended user banner + notification types`

PR title: "TASK-038: User suspension & admin moderation"
