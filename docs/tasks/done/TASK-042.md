# TASK-039: Simple Booking System — Ubunye Intake + Paystack + Creator Payout
## Priority: CRITICAL | Phase: V3 | LAST FEATURE BEFORE LAUNCH
## Created: 2026-03-19

---

## Pre-Session Setup

```
/new-session
```
Branch name: `feature/task-039-booking-system`

Read these files first:
```
Read CLAUDE.md
Read MEMORY.md
Read lib/constants.ts
Read lib/payments/ (all files)
Read lib/ubunye/system-prompt.ts
Read app/api/ubunye-chat/route.ts
```

---

## Context

Simple booking flow. Client sees a creator, books them through Ubunye or booking form. Ubunye collects shoot details, calculates total with VAT, client pays via Paystack. Money goes to platform account. Admin confirms. Creator accepts. Job happens. Client marks complete + rates. Platform transfers 85% to creator, keeps 15%.

Five statuses: pending → paid → accepted → completed → paid_out

NO overengineering. NO embeddings. NO matching algorithm. Admin assigns manually for now.

---

## Paystack Fees (South Africa)

```
Client payment:     2.9% + R1 per transaction
VAT on fee:         15% on the Paystack fee
Settlement:         2 working days
Transfer to creator: small per-transfer fee
Top-up fee:         1.0% for EFT top-up to transfer balance
```

---

## Database Migration

Create `lib/migrations/009-booking-system.sql`:

```sql
-- ═══ 1. Bookings table ═══

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  
  -- Client
  client_id uuid references auth.users(id) not null,
  client_email text not null,
  
  -- Creator (assigned by admin or from direct booking)
  creator_id uuid references profiles(id),
  
  -- What
  booking_type text not null check (booking_type in ('production', 'rental', 'crew')),
  project_category text not null,
  project_description text not null,
  deliverables text not null,
  duration_hours integer not null,
  location text,
  preferred_dates text,
  
  -- Money
  subtotal integer not null,
  vat integer not null,
  total integer not null,
  platform_commission integer not null default 15,
  platform_amount integer not null,
  creator_amount integer not null,
  paystack_fee_estimate integer,
  
  -- Payment
  payment_status text default 'unpaid' check (payment_status in ('unpaid', 'paid', 'refunded')),
  paystack_reference text,
  paystack_access_code text,
  paid_at timestamptz,
  
  -- Creator payout
  payout_status text default 'pending' check (payout_status in ('pending', 'processing', 'paid', 'failed')),
  payout_reference text,
  paid_out_at timestamptz,
  
  -- Status
  status text default 'pending' check (status in (
    'pending', 'paid', 'accepted', 'completed', 'paid_out', 'cancelled'
  )),
  
  -- Rating
  client_rating integer check (client_rating >= 1 and client_rating <= 5),
  client_review text,
  
  -- Admin
  admin_notes text,
  
  -- Timestamps
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text
);

alter table bookings enable row level security;

create policy "Clients view own bookings" on bookings
  for select using (auth.uid() = client_id);

create policy "Creators view assigned bookings" on bookings
  for select using (auth.uid() = creator_id);

create policy "Authenticated users create bookings" on bookings
  for insert with check (auth.uid() = client_id);

create policy "Admin manages all" on bookings
  for all using (true);

-- Index for common queries
create index idx_bookings_status on bookings (status);
create index idx_bookings_client on bookings (client_id);
create index idx_bookings_creator on bookings (creator_id);

-- ═══ 2. Add bank details to profiles for creator payouts ═══

alter table profiles add column if not exists bank_name text;
alter table profiles add column if not exists bank_account_number text;
alter table profiles add column if not exists bank_account_type text 
  check (bank_account_type in ('cheque', 'savings', 'transmission'));
alter table profiles add column if not exists bank_branch_code text;
alter table profiles add column if not exists paystack_recipient_code text;
```

---

## Implementation

### PART 1: Constants

Add to `lib/constants.ts`:

```typescript
BOOKING: {
  platformCommission: 15, // percentage
  vatRate: 15, // percentage
  minBookingHours: 1,
  maxBookingHours: 72,
  cancellationPolicy: 'Free cancellation up to 48 hours before the shoot. After that, deposit is non-refundable.',
  projectCategories: [
    'Wedding Photography',
    'Wedding Cinematography',
    'Portrait Photography',
    'Corporate Photography',
    'Corporate Video',
    'Music Video',
    'Event Coverage',
    'Product Photography',
    'Real Estate Photography',
    'Content Creation',
    'Documentary',
    'Short Film',
    'Other',
  ],
  deliverableTypes: [
    'Edited Photos (Digital)',
    'Printed Photos',
    'Highlight Video',
    'Full-Length Video',
    'Raw Files',
    'Social Media Edits',
    'All of the Above',
  ],
  bankNames: [
    'ABSA',
    'FNB (First National Bank)',
    'Standard Bank',
    'Nedbank',
    'Capitec',
    'TymeBank',
    'African Bank',
    'Investec',
    'Discovery Bank',
  ],
} as const,
```

---

### PART 2: Paystack Integration

#### 2A. Create `lib/payments/paystack.ts`:

```typescript
const PAYSTACK_BASE = 'https://api.paystack.co';
const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;

const headers = {
  Authorization: `Bearer ${SECRET_KEY}`,
  'Content-Type': 'application/json',
};

export const paystackProvider = {
  
  // Initialize a payment — returns URL for client to pay
  async initiatePayment({
    amount, // in ZAR (not kobo)
    email,
    reference,
    callbackUrl,
    metadata,
  }: {
    amount: number;
    email: string;
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, any>;
  }) {
    const response = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        amount: Math.round(amount * 100), // Convert to kobo/cents
        email,
        reference,
        callback_url: callbackUrl,
        metadata,
        currency: 'ZAR',
      }),
    });

    const data = await response.json();
    if (!data.status) throw new Error(data.message);

    return {
      paymentUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
    };
  },

  // Verify a payment after callback
  async verifyPayment(reference: string) {
    const response = await fetch(
      `${PAYSTACK_BASE}/transaction/verify/${reference}`,
      { headers }
    );

    const data = await response.json();
    if (!data.status) throw new Error(data.message);

    return {
      success: data.data.status === 'success',
      amount: data.data.amount / 100, // Convert from kobo to ZAR
      reference: data.data.reference,
      paidAt: data.data.paid_at,
      metadata: data.data.metadata,
    };
  },

  // Create a transfer recipient (creator's bank account)
  async createRecipient({
    name,
    accountNumber,
    bankCode,
    type,
  }: {
    name: string;
    accountNumber: string;
    bankCode: string;
    type: 'nuban' | 'basa'; // basa for South Africa
  }) {
    const response = await fetch(`${PAYSTACK_BASE}/transferrecipient`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'basa', // South African bank account
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'ZAR',
      }),
    });

    const data = await response.json();
    if (!data.status) throw new Error(data.message);

    return {
      recipientCode: data.data.recipient_code,
    };
  },

  // Transfer money to creator after job completion
  async transferToCreator({
    amount,
    recipientCode,
    reference,
    reason,
  }: {
    amount: number;
    recipientCode: string;
    reference: string;
    reason: string;
  }) {
    const response = await fetch(`${PAYSTACK_BASE}/transfer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(amount * 100),
        recipient: recipientCode,
        reference,
        reason,
        currency: 'ZAR',
      }),
    });

    const data = await response.json();
    if (!data.status) throw new Error(data.message);

    return {
      transferCode: data.data.transfer_code,
      reference: data.data.reference,
      status: data.data.status,
    };
  },

  // List SA banks (for dropdown)
  async listBanks() {
    const response = await fetch(
      `${PAYSTACK_BASE}/bank?country=south_africa`,
      { headers }
    );
    const data = await response.json();
    return data.data; // array of { name, code }
  },
};
```

#### 2B. Update `lib/payments/index.ts`:

```typescript
import { paystackProvider } from './paystack';

export function getPaymentProvider() {
  const provider = process.env.PAYMENT_PROVIDER || 'paystack';
  switch (provider) {
    case 'paystack': return paystackProvider;
    default: return paystackProvider;
  }
}
```

#### 2C. Webhook — `app/api/webhooks/paystack/route.ts`:

```typescript
import crypto from 'crypto';

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('x-paystack-signature');

  // Verify webhook signature
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
    .update(body)
    .digest('hex');

  if (hash !== signature) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(body);

  switch (event.event) {
    case 'charge.success': {
      const reference = event.data.reference;
      
      // Update booking payment status
      await supabase.from('bookings').update({
        payment_status: 'paid',
        status: 'paid',
        paid_at: new Date().toISOString(),
        paystack_reference: reference,
      }).eq('reference', reference);

      // Get booking details for email
      const { data: booking } = await supabase
        .from('bookings')
        .select('*, creator:profiles!creator_id(display_name, email)')
        .eq('reference', reference)
        .single();

      // Email to admin: "Payment received for booking [ref]"
      // Email to creator: "New paid gig: [details]"
      // Email to client: "Payment confirmed. Your creator will be in touch."

      break;
    }

    case 'transfer.success': {
      const reference = event.data.reference;
      await supabase.from('bookings').update({
        payout_status: 'paid',
        paid_out_at: new Date().toISOString(),
        payout_reference: reference,
      }).eq('payout_reference', reference);
      break;
    }

    case 'transfer.failed': {
      const reference = event.data.reference;
      await supabase.from('bookings').update({
        payout_status: 'failed',
      }).eq('payout_reference', reference);
      // Email admin: "Creator payout failed for booking [ref]"
      break;
    }
  }

  return Response.json({ received: true });
}
```

#### 2D. Payment callback — `app/api/bookings/callback/route.ts`:

```typescript
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const reference = searchParams.get('reference');

  if (!reference) {
    return NextResponse.redirect(new URL('/dashboard/bookings?error=missing_reference', req.url));
  }

  // Verify with Paystack
  const payment = await getPaymentProvider();
  const result = await payment.verifyPayment(reference);

  if (result.success) {
    return NextResponse.redirect(
      new URL('/dashboard/bookings?status=success&ref=' + reference, req.url)
    );
  }

  return NextResponse.redirect(
    new URL('/dashboard/bookings?status=failed', req.url)
  );
}
```

---

### PART 3: Booking API

#### 3A. Create booking — `app/api/bookings/route.ts`:

```typescript
import { nanoid } from 'nanoid';

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return Response.json({ error: 'Must be logged in to book' }, { status: 401 });

  const body = await req.json();
  const {
    creator_id,
    booking_type,
    project_category,
    project_description,
    deliverables,
    duration_hours,
    location,
    preferred_dates,
  } = body;

  // Validate
  if (!project_category || !project_description || !deliverables || !duration_hours) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Calculate pricing from PRODUCTION_SERVICES
  const hourlyRate = getHourlyRate(booking_type, project_category);
  const subtotal = hourlyRate * duration_hours;
  const vat = Math.round(subtotal * (BOOKING.vatRate / 100));
  const total = subtotal + vat;
  const platformAmount = Math.round(total * (BOOKING.platformCommission / 100));
  const creatorAmount = total - platformAmount;

  const reference = `BK-${nanoid(10)}`;

  // Create booking
  const { data: booking, error } = await supabase.from('bookings').insert({
    reference,
    client_id: user.id,
    client_email: user.email,
    creator_id: creator_id || null,
    booking_type,
    project_category,
    project_description,
    deliverables,
    duration_hours,
    location,
    preferred_dates,
    subtotal,
    vat,
    total,
    platform_commission: BOOKING.platformCommission,
    platform_amount: platformAmount,
    creator_amount: creatorAmount,
    status: 'pending',
  }).select().single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Initialize Paystack payment
  const payment = getPaymentProvider();
  const { paymentUrl, accessCode } = await payment.initiatePayment({
    amount: total,
    email: user.email,
    reference,
    callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/bookings/callback`,
    metadata: {
      booking_id: booking.id,
      booking_type,
      project_category,
    },
  });

  // Save Paystack access code
  await supabase.from('bookings').update({
    paystack_access_code: accessCode,
  }).eq('id', booking.id);

  // Email admin: "New booking from [client email] — [project_category]"

  return Response.json({
    success: true,
    booking: {
      id: booking.id,
      reference,
      total,
      paymentUrl, // redirect client here to pay
    },
  });
}

// GET — list own bookings
export async function GET(req: Request) {
  const user = await getUser(req);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('bookings')
    .select('*')
    .eq('client_id', user.id)
    .order('created_at', { ascending: false });

  return Response.json({ bookings: data });
}
```

---

### PART 4: Ubunye Booking Flow

Update the system prompt in `lib/ubunye/system-prompt.ts`:

Add this to Ubunye's behaviour rules:

```
BOOKING FLOW:
When a client wants to book a creator or production service:

1. Check if user is logged in. If not:
   "You'll need to sign in first to make a booking. [Sign in](/login)"

2. If logged in, ask these questions ONE AT A TIME:

   "What type of shoot do you need?"
   → Show options: Wedding, Portrait, Corporate, Music Video, Event, Content Creation, Other
   
   "How many hours do you expect the shoot to take?"
   → Get a number
   
   "What deliverables do you need?"
   → Options: Edited photos, Video highlights, Full video, Raw files, Prints, All
   
   "Where is the shoot?"
   → City or area
   
   "When do you need this?"
   → Date or date range

3. Calculate the quote using PRODUCTION_SERVICES rates:
   - Photography: R{rate}/hr
   - Cinematography: R{rate}/hr
   - Post-production: R{rate}/hr
   - Add VAT at {vatRate}%
   - Show platform commission is included

4. Present the summary:
   "Here's your booking quote:
   
   **{project_category}**
   Duration: {hours} hours
   Deliverables: {deliverables}
   Location: {location}
   Date: {dates}
   
   Subtotal: R{subtotal}
   VAT (15%): R{vat}
   **Total: R{total}**
   
   Ready to book? I'll take you to payment."

5. If client confirms, provide the booking link:
   "Great! [Click here to confirm and pay →](/book?category={cat}&hours={hrs}&deliverables={del}&location={loc}&dates={dates})"
   
   The /book page pre-fills the form with Ubunye's collected data and shows the Paystack payment button.
```

---

### PART 5: Booking Page

#### 5A. Create `app/(platform)/book/page.tsx`:

Reads URL params from Ubunye or direct navigation. Shows summary and Paystack pay button.

```
CONFIRM YOUR BOOKING
─────────────────────

Wedding Photography
Duration: 8 hours
Deliverables: Edited photos + Highlight video
Location: Sandton, JHB
Date: 22 March 2026

Creator: Thabang Mokwena (if pre-selected)
         or "We'll match you with the best creator"

Subtotal:  R12,000
VAT (15%): R1,800
Total:     R13,800

[PAY R13,800 WITH PAYSTACK]

By paying, you agree to our Terms of Service.
Free cancellation up to 48 hours before the shoot.
```

On click: creates booking via API → redirects to Paystack checkout → Paystack redirects back to callback → callback redirects to /dashboard/bookings.

---

### PART 6: Client Bookings Dashboard

#### 6A. Create `app/(dashboard)/dashboard/bookings/page.tsx`:

```
YOUR BOOKINGS

┌──────────────────────────────────────┐
│ BK-a8f3k2m9                         │
│ Wedding Photography      ✅ PAID    │
│ 22 March 2026 | Sandton             │
│ Total: R13,800                      │
│ Creator: Thabang M.                 │
│                                      │
│ Status: Waiting for creator to accept│
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ BK-k9d2f4n1                         │
│ Music Video              🎬 ACCEPTED│
│ 28-29 March 2026 | Braamfontein     │
│ Total: R25,300                      │
│ Creator: Creator B                   │
│                                      │
│ [MARK AS COMPLETE]                   │
└──────────────────────────────────────┘
```

When client clicks MARK AS COMPLETE:
- Show rating form: 1-5 stars + review text
- Submit: updates booking status to 'completed', saves rating
- Shows: "Thanks for your rating! Creator has been notified."

---

### PART 7: Creator Gigs Dashboard

#### 7A. Create `app/(dashboard)/dashboard/gigs/page.tsx`:

Shows bookings where creator_id = current user.

```
YOUR GIGS

┌──────────────────────────────────────┐
│ Wedding Photography       💰 PAID   │
│ 22 March 2026 | Sandton             │
│ Duration: 8 hours                    │
│ Deliverables: Photos + Video         │
│ You'll earn: R11,730                 │
│                                      │
│ Client brief:                        │
│ "Need coverage for a 150-guest       │
│  wedding at a garden venue..."       │
│                                      │
│ [ACCEPT GIG]  [DECLINE]             │
└──────────────────────────────────────┘
```

Creator does NOT see: client email, client phone, client full name.
Creator sees: project details, dates, location, their earnings, brief.

On ACCEPT: status → 'accepted', email sent to client.
On DECLINE: admin notified to find alternative.

---

### PART 8: Admin Bookings

#### 8A. Update `app/(admin)/admin/bookings/page.tsx`:

```
BOOKINGS

Tabs: [Pending] [Paid X] [Accepted] [Completed] [All]

┌─────────────────────────────────────────┐
│ BK-a8f3k2m9               💳 PAID      │
│                                          │
│ Client: Ntando M. | ntando@email.com    │
│ Type: Wedding Photography               │
│ Date: 22 March | Sandton                │
│ Duration: 8 hours                        │
│                                          │
│ Total: R13,800                           │
│ Platform (15%): R2,070                   │
│ Creator payout: R11,730                  │
│                                          │
│ Creator: Thabang M. (assigned)           │
│ Payout: Pending                          │
│                                          │
│ Admin notes: [textarea]                  │
│                                          │
│ [REASSIGN CREATOR] [CANCEL + REFUND]    │
│ [TRIGGER PAYOUT]                         │
└─────────────────────────────────────────┘
```

TRIGGER PAYOUT:
- Only visible after status = 'completed'
- Calls Paystack transfer API
- Sends 85% to creator's bank account
- Updates payout_status = 'processing'
- Webhook confirms → payout_status = 'paid'

---

### PART 9: Creator Bank Details

#### 9A. Add to `app/(dashboard)/dashboard/profile/page.tsx`:

Only visible to verified creators:

```
PAYOUT SETTINGS
─────────────────

Bank: [dropdown — ABSA, FNB, Standard Bank, etc.]
Account Number: [input]
Account Type: [Cheque / Savings]
Branch Code: [input]

[SAVE BANK DETAILS]

Your bank details are encrypted and only used to process your earnings.
```

On save:
- Store in profiles (bank_name, bank_account_number, etc.)
- Create Paystack transfer recipient
- Save paystack_recipient_code to profile

---

### PART 10: Email Notifications

At each status change:

```
pending → paid:
  Admin: "New paid booking: [category] by [client email]. Assign a creator."
  Creator: "You have a new gig! Check your dashboard."
  Client: "Payment confirmed! We're assigning your creator."

paid → accepted:
  Client: "Great news! [Creator name] accepted your booking for [dates]."

accepted → completed:
  Admin: "Booking [ref] completed. Ready for payout."
  Creator: "Gig complete! Your payout of R[amount] is being processed."
  Client: "How was your experience? [Rate your creator →]"

completed → paid_out:
  Creator: "R[amount] has been transferred to your bank account."
```

---


EDGE CASE 1: Client pays but no creator available
  → Money sits in your Paystack account
  → Admin has 48 hours to find a creator
  → If no creator found → admin triggers refund
  → Paystack refund API: full refund to client
  → Status: cancelled, refund_reason: "no_creator_available"

EDGE CASE 2: Creator declines after client paid
  → Admin reassigns to another creator
  → If no alternative → full refund to client
  → Client notified: "We're finding you a new creator"

EDGE CASE 3: Client cancels
  → Before 48 hours of shoot date: full refund
  → Within 48 hours: no refund (keep deposit)
  → Add cancellation_deadline to booking = shoot_date - 48hrs
  → Client dashboard shows: "Free cancellation until [date]"

EDGE CASE 4: Creator no-shows
  → Client reports via dashboard: "Creator didn't show"
  → Admin investigates
  → Full refund to client
  → Creator flagged (add no_show_count to profiles)
  → 3 no-shows → available_for_hire set to false

EDGE CASE 5: Client disputes quality
  → Status: 'disputed'
  → Admin reviews
  → Options: full refund, partial refund, no refund
  → Paystack supports partial refunds

EDGE CASE 6: Payment fails or expires
  → Paystack link expires after 24 hours
  → Booking stays as 'pending'
  → After 72 hours with no payment → auto-cancel
  → Cron job or manual admin cleanup

EDGE CASE 7: Double payment
  → Paystack prevents this with unique reference
  → Each booking has unique reference: BK-xxxxxxxx
  → Second payment attempt returns "duplicate transaction"

EDGE CASE 8: Creator payout fails
  → Wrong bank details
  → Webhook: transfer.failed
  → Admin notified
  → Admin contacts creator to fix bank details
  → Retrigger payout

EDGE CASE 9: Client never marks complete
  → After 14 days past shoot date with no action
  → Admin can force-complete
  → Or send reminder email to client: "How was your shoot?"
  → Auto-complete after 30 days (creator gets paid regardless)

EDGE CASE 10: Refund after creator already paid out
  → Don't auto-refund after payout
  → Admin handles manually
  → Platform absorbs the loss or negotiates with creator

## API Routes Summary

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| POST | /api/bookings | Client | Create booking + get payment URL |
| GET | /api/bookings | Client | List own bookings |
| GET | /api/bookings/callback | Public | Paystack redirect after payment |
| PATCH | /api/bookings/[id]/status | Auth | Update status (accept/complete) |
| POST | /api/bookings/[id]/review | Client | Submit rating |
| POST | /api/webhooks/paystack | Public | Paystack webhook |
| GET | /api/admin/bookings | Admin | All bookings |
| PATCH | /api/admin/bookings/[id] | Admin | Admin update (assign/cancel) |
| POST | /api/admin/bookings/[id]/payout | Admin | Trigger creator payout |

---

## Environment Variables

Add to .env.local and Vercel:
```
PAYMENT_PROVIDER=paystack
PAYSTACK_SECRET_KEY=sk_test_xxxxx
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_test_xxxxx
```

Add webhook URL in Paystack dashboard:
```
https://thabangvision.com/api/webhooks/paystack
```

---

## Acceptance Criteria

- [ ] Client can book through Ubunye (collects details, calculates price)
- [ ] Client can book through /book page directly
- [ ] Must be logged in to book
- [ ] Paystack payment initializes and redirects correctly
- [ ] Webhook confirms payment and updates booking status
- [ ] Admin sees all bookings with financial breakdown
- [ ] Admin can assign/reassign creator
- [ ] Creator sees gigs in dashboard with earnings
- [ ] Creator can accept or decline
- [ ] Client can mark complete and rate 1-5 stars
- [ ] Admin can trigger payout to creator
- [ ] Paystack transfer sends money to creator bank
- [ ] Email notifications at each status change
- [ ] Creator bank details saved securely in profile
- [ ] All existing tests pass
- [ ] npm run build passes

---

## Update MEMORY.md

After completion, append:

```
## Session: TASK-039 — Booking System (2026-03-XX)
### Branch: feature/task-039-booking-system
### Built:
- Complete booking lifecycle: pending → paid → accepted → completed → paid_out
- Paystack integration: payment init, verify, webhook, transfers
- Ubunye booking flow with guided questions and quote calculation
- /book confirmation page with Paystack checkout
- Client bookings dashboard with rating system
- Creator gigs dashboard with accept/decline
- Admin bookings page with payout trigger
- Creator bank details in profile
- Email notifications at each status change
### Database: 009-booking-system.sql
### Routes: /api/bookings/*, /api/webhooks/paystack, /api/admin/bookings/*
### Tests: [results]
### Notes: [blockers or follow-ups]
```

---

## Post-Session

```
/pre-merge
```
Verify CI passes. Merge to main. Run `/end-session`.

THEN SHIP. NO MORE FEATURES.