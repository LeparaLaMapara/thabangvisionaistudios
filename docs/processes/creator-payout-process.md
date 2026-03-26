# CREATOR PAYOUT PROCESS — Auto-Payout on Client Approval

## Overview

When a client approves delivered work, the creator gets paid automatically. No admin step needed. Money flows from the platform's Paystack account directly to the creator's bank account within minutes.

Admin only gets involved when something goes wrong — failed transfer, dispute, or cancellation.

---

## Payout Principles

```
1. AUTOMATIC — client approves → payout triggers instantly
2. NO ADMIN BOTTLENECK — admin handles exceptions only
3. 85/15 SPLIT — creator keeps 85% of what client paid
4. SPLIT ON GROSS — "85% of client's total" not "85% after fees"
5. NO RAW BANK DATA — Paystack recipient codes only
6. INSTANT — payout triggers within seconds of approval
7. SETTLEMENT — Paystack sends to creator's bank within 1-2 business days
8. AUTO-APPROVE — if client doesn't respond in 7 days, auto-approve + auto-payout
```

---

## Payout Trigger Flow

```
CLIENT APPROVES WORK
         │
         ▼
System calculates payout:
  Order total: R43,225
  Platform commission (15%): R6,483.75
  Creator payout (85%): R36,741.25
         │
         ▼
System checks creator has valid recipient code:
  profiles.paystack_recipient_code exists? 
  YES → proceed
  NO → flag for admin, email creator "Add bank details to get paid"
         │
         ▼
System calls Paystack Transfer API:
  POST api.paystack.co/transfer
  source: 'balance'
  amount: 3674125 (kobo/cents)
  recipient: 'RCP_xxxxx'
  reason: 'Payout for order #BK-a8f3k2m9 — Wedding Premium'
  reference: 'PO-BK-a8f3k2m9' (payout reference)
         │
         ▼
Paystack processes transfer:
  → Money sent to creator's bank account
  → Webhook: transfer.success or transfer.failed
         │
         ▼
IF SUCCESS:
  payout_status → 'paid'
  status → 'paid_out'
  Email creator: "R36,741.25 sent to FNB ****6789"
  Email admin: "Payout complete for #BK-a8f3k2m9"

IF FAILED:
  payout_status → 'failed'
  Email admin: "Payout failed for #BK-a8f3k2m9 — check creator bank details"
  Email creator: "Payout failed — please update your bank details"
  Admin manually retries after creator fixes details
```

---

## Auto-Payout Implementation

```typescript
// lib/payments/payout.ts

import { getPaymentProvider } from '@/lib/payments';

interface PayoutResult {
  success: boolean;
  reference?: string;
  error?: string;
}

export async function triggerCreatorPayout(bookingId: string): Promise<PayoutResult> {
  const supabase = await createAdminClient();

  // 1. Get booking details
  const { data: booking } = await supabase
    .from('bookings')
    .select(`
      *,
      creator:profiles!creator_id (
        id, display_name, email,
        paystack_recipient_code, bank_name, bank_last4
      )
    `)
    .eq('id', bookingId)
    .single();

  if (!booking) return { success: false, error: 'Booking not found' };
  if (booking.status !== 'completed') return { success: false, error: 'Booking not completed' };
  if (booking.payout_status === 'paid') return { success: false, error: 'Already paid out' };
  if (booking.payout_status === 'processing') return { success: false, error: 'Payout already processing' };

  // 2. Check creator has bank details
  const creator = booking.creator;
  if (!creator?.paystack_recipient_code) {
    // Flag for admin — creator needs to add bank details
    await supabase.from('bookings').update({
      payout_status: 'failed',
      admin_notes: (booking.admin_notes || '') + '\nPayout failed: Creator has no bank details.',
    }).eq('id', bookingId);

    // Email creator
    await sendEmail({
      to: creator.email,
      subject: 'Add your bank details to get paid',
      body: `Your work on order #${booking.reference} has been approved!
             Add your bank details in your dashboard to receive R${booking.creator_amount.toLocaleString()}.
             [Update bank details →]`,
    });

    // Email admin
    await sendEmail({
      to: STUDIO.email,
      subject: `Payout blocked — ${creator.display_name} has no bank details`,
      body: `Order #${booking.reference} approved but creator has no bank details.
             Creator: ${creator.display_name}
             Amount: R${booking.creator_amount.toLocaleString()}`,
    });

    return { success: false, error: 'Creator has no bank details' };
  }

  // 3. Generate payout reference
  const payoutReference = `PO-${booking.reference}`;

  // 4. Update status to processing (prevent double payout)
  await supabase.from('bookings').update({
    payout_status: 'processing',
    payout_reference: payoutReference,
  }).eq('id', bookingId);

  // 5. Call Paystack transfer
  try {
    const paystack = getPaymentProvider();
    const result = await paystack.transferToCreator({
      amount: booking.creator_amount,
      recipientCode: creator.paystack_recipient_code,
      reference: payoutReference,
      reason: `Payout for order #${booking.reference} — ${booking.package_name || booking.booking_type}`,
    });

    // 6. Transfer initiated — webhook will confirm success/failure
    return { success: true, reference: payoutReference };

  } catch (error) {
    // Transfer API failed
    await supabase.from('bookings').update({
      payout_status: 'failed',
      admin_notes: (booking.admin_notes || '') + `\nPayout API error: ${error.message}`,
    }).eq('id', bookingId);

    // Email admin
    await sendEmail({
      to: STUDIO.email,
      subject: `Payout API failed — Order #${booking.reference}`,
      body: `Transfer API call failed.
             Creator: ${creator.display_name}
             Amount: R${booking.creator_amount.toLocaleString()}
             Error: ${error.message}
             Action: Check Paystack balance and retry manually.`,
    });

    return { success: false, error: error.message };
  }
}
```

### Trigger on client approval:

```typescript
// In the approve order handler:
// PATCH /api/orders/[ref]/approve

export async function PATCH(req: Request) {
  const user = await getUser(req);
  const { rating, review } = await req.json();
  const reference = getParamFromUrl(req, 'ref');

  // Verify client owns this order
  const { data: booking } = await supabase
    .from('bookings')
    .select('*')
    .eq('reference', reference)
    .eq('client_id', user.id)
    .eq('status', 'delivered')
    .single();

  if (!booking) return Response.json({ error: 'Order not found' }, { status: 404 });

  // 1. Update order to completed + save rating
  await supabase.from('bookings').update({
    status: 'completed',
    client_rating: rating,
    client_review: review,
    completed_at: new Date().toISOString(),
  }).eq('id', booking.id);

  // 2. AUTO-TRIGGER PAYOUT — no admin step
  const payoutResult = await triggerCreatorPayout(booking.id);

  // 3. Send notification emails
  await sendCompletionEmails(booking, rating, review, payoutResult);

  return Response.json({
    success: true,
    message: 'Order approved. Creator payment is being processed.',
    payout: payoutResult.success ? 'processing' : 'pending_bank_details',
  });
}
```

### Trigger on auto-approve (7-day timeout):

```typescript
// Cron job: /api/cron/auto-approve
// Runs daily

export async function GET(req: Request) {
  // Verify cron secret
  
  const { data: overdueOrders } = await supabase
    .from('bookings')
    .select('*')
    .eq('status', 'delivered')
    .lt('auto_approve_at', new Date().toISOString());

  for (const booking of overdueOrders || []) {
    // Auto-approve
    await supabase.from('bookings').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      admin_notes: (booking.admin_notes || '') + '\nAuto-approved after 7 days.',
    }).eq('id', booking.id);

    // Auto-trigger payout
    await triggerCreatorPayout(booking.id);

    // Email client
    await sendEmail({
      to: booking.client_email,
      subject: `Order #${booking.reference} auto-approved`,
      body: `Your order was automatically approved after 7 days.
             Creator has been paid.
             If you have any issues, contact support.`,
    });
  }

  return Response.json({ processed: overdueOrders?.length || 0 });
}
```

---

## Creator Bank Setup

### One-time setup flow:

```
Creator goes to /dashboard/profile

PAYOUT SETTINGS
──────────────────

Status: ⚠️ Bank details required to receive payouts

Bank *
[▾ Select your bank                    ]
  ABSA
  FNB (First National Bank)
  Standard Bank
  Nedbank
  Capitec
  TymeBank
  African Bank
  Investec
  Discovery Bank

Account number *
[                                       ]

Account type *
( ) Cheque   ( ) Savings

[SAVE & VERIFY BANK DETAILS]

🔒 Your bank details are sent directly to Paystack.
   We only store a reference code, never your account number.
```

### Backend — create Paystack recipient:

```typescript
// POST /api/dashboard/bank-details
export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { bankCode, accountNumber, accountType } = await req.json();

  // Get creator profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, paystack_recipient_code')
    .eq('id', user.id)
    .single();

  // Delete old recipient if exists
  if (profile.paystack_recipient_code) {
    // Paystack doesn't have a delete endpoint
    // Old recipient becomes inactive when new one is created
  }

  // Create new Paystack recipient
  const response = await fetch('https://api.paystack.co/transferrecipient', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'basa', // South African bank account
      name: profile.display_name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'ZAR',
    }),
  });

  const data = await response.json();

  if (!data.status) {
    return Response.json({ 
      error: 'Bank verification failed. Please check your details.' 
    }, { status: 400 });
  }

  // Store ONLY the recipient code and display info
  await supabase.from('profiles').update({
    paystack_recipient_code: data.data.recipient_code,
    bank_name: data.data.details.bank_name,
    bank_last4: accountNumber.slice(-4),
    bank_verified: true,
  }).eq('id', user.id);

  // IMPORTANT: accountNumber is NOT stored anywhere
  // It only existed for this API call

  return Response.json({
    success: true,
    bank: `${data.data.details.bank_name} ****${accountNumber.slice(-4)}`,
  });
}
```

### After bank setup, profile shows:

```
PAYOUT SETTINGS
──────────────────

Bank: FNB ****6789 ✅ Verified
[UPDATE BANK DETAILS]

You'll receive payouts automatically when clients
approve your delivered work.
```

### Bank codes for SA banks:

```typescript
// Fetch dynamically from Paystack or use constants
const SA_BANKS = [
  { name: 'ABSA', code: '632005' },
  { name: 'FNB (First National Bank)', code: '250655' },
  { name: 'Standard Bank', code: '051001' },
  { name: 'Nedbank', code: '198765' },
  { name: 'Capitec', code: '470010' },
  { name: 'TymeBank', code: '678910' },
  { name: 'African Bank', code: '430000' },
  { name: 'Investec', code: '580105' },
  { name: 'Discovery Bank', code: '679000' },
];

// OR fetch live from Paystack:
const response = await fetch('https://api.paystack.co/bank?country=south_africa', {
  headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
});
const { data: banks } = await response.json();
// Returns: [{ name: 'First National Bank', code: '250655' }, ...]
```

---

## Creator Earnings Dashboard

### Earnings overview: `/dashboard/earnings`

```
YOUR EARNINGS
──────────────────

THIS MONTH
┌────────────┐ ┌────────────┐ ┌────────────┐
│ R73,482    │ │ R12,850    │ │ R86,332    │
│ Earned     │ │ Pending    │ │ Total      │
│ (paid out) │ │ (in escrow)│ │            │
└────────────┘ └────────────┘ └────────────┘

ALL TIME
┌────────────┐ ┌────────────┐ ┌────────────┐
│ R284,500   │ │ 23         │ │ 4.8 ⭐     │
│ Total      │ │ Completed  │ │ Average    │
│ earned     │ │ orders     │ │ rating     │
└────────────┘ └────────────┘ └────────────┘

── PAYOUT HISTORY ──

┌──────────────────────────────────────────────────┐
│ DATE        ORDER         AMOUNT      STATUS     │
│──────────────────────────────────────────────────│
│ 6 Apr 2026  #BK-a8f3k2m9 R36,741.25 ✅ Paid    │
│ 2 Apr 2026  #BK-k9d2f4n1 R2,932.50  ✅ Paid    │
│ 28 Mar 2026 #BK-m4n7p2q8 R12,750.00 ✅ Paid    │
│ 25 Mar 2026 #BK-r5t8w1x3 R8,500.00  ⏳ Pending │
└──────────────────────────────────────────────────┘

── PENDING PAYOUTS ──

┌──────────────────────────────────────────────────┐
│ #BK-r5t8w1x3                                     │
│ Portrait Session for Lerato K.                    │
│ Delivered: 23 Mar 2026                            │
│ Auto-approval: 30 Mar 2026                        │
│ You'll earn: R8,500.00                            │
│ Status: Awaiting client approval                  │
└──────────────────────────────────────────────────┘
```

### Earnings data query:

```typescript
// GET /api/dashboard/earnings
export async function GET(req: Request) {
  const user = await getUser(req);

  // Paid out orders
  const { data: paidOrders } = await supabase
    .from('bookings')
    .select('reference, package_name, creator_amount, paid_out_at, client_rating')
    .eq('creator_id', user.id)
    .eq('payout_status', 'paid')
    .order('paid_out_at', { ascending: false });

  // Pending orders (delivered, awaiting approval)
  const { data: pendingOrders } = await supabase
    .from('bookings')
    .select('reference, package_name, creator_amount, delivered_at, auto_approve_at')
    .eq('creator_id', user.id)
    .in('status', ['delivered', 'completed'])
    .eq('payout_status', 'pending');

  // Calculate totals
  const totalEarned = paidOrders?.reduce((sum, o) => sum + o.creator_amount, 0) || 0;
  const totalPending = pendingOrders?.reduce((sum, o) => sum + o.creator_amount, 0) || 0;
  const completedCount = paidOrders?.length || 0;
  const avgRating = paidOrders?.length 
    ? paidOrders.reduce((sum, o) => sum + (o.client_rating || 0), 0) / paidOrders.length 
    : 0;

  return Response.json({
    totalEarned,
    totalPending,
    completedCount,
    avgRating: Math.round(avgRating * 10) / 10,
    paidOrders,
    pendingOrders,
  });
}
```

---

## Creator Order View

### What creator sees for each order:

```
/dashboard/orders/BK-a8f3k2m9

ORDER #BK-a8f3k2m9
──────────────────

Package: Wedding Premium
Status: ACCEPTED ✅

── PROJECT BRIEF ──

Event: 22 March 2026
Location: Sandton, Johannesburg
Brief: "150 guest wedding at garden venue.
       Ceremony 2pm, reception until 10pm.
       Romantic, cinematic style."
Requirements: "Drone shots of venue"

── DELIVERABLES ──

✓ 10 hours coverage
✓ 300 edited photos
✓ 3-min highlight reel
✓ Full ceremony edit
✓ Online gallery + USB
✓ Drone coverage (extra)
✓ Same-day sneak peek (extra)

Delivery deadline: 5 April 2026 (14 working days)

── YOUR EARNINGS ──

Client paid:               R43,225.00
Platform commission (15%): -R6,483.75
You'll receive:            R36,741.25

Paid to: FNB ****6789

── ACTIONS ──

[DELIVER WORK]  (when ready)
[CONTACT SUPPORT]
```

### What creator NEVER sees:

```
❌ Client email address
❌ Client phone number
❌ Client last name (show first name + initial only)
❌ Client payment method
❌ Other client orders
❌ Paystack fees breakdown
❌ Platform net profit
```

### Client display name for creator:

```typescript
// Show to creator: "Ntando M." not "Ntando Mashinini"
function getClientDisplayName(fullName: string): string {
  const parts = fullName.trim().split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
```

---

## Payout Failure Handling

### When Paystack transfer fails:

```
COMMON REASONS:
  1. Insufficient Paystack balance (you haven't received enough)
  2. Wrong bank details (account doesn't exist)
  3. Creator's bank account is closed
  4. Paystack system error (temporary)
  5. Daily transfer limit reached
```

### Retry flow:

```
Transfer fails → webhook: transfer.failed
         │
         ▼
System updates: payout_status = 'failed'
         │
         ▼
Email to admin:
  "Payout failed for #BK-a8f3k2m9
   Creator: Thabang M.
   Amount: R36,741.25
   Reason: [Paystack error message]
   Action needed: verify bank details and retry"
         │
         ▼
Email to creator:
  "Your payout of R36,741.25 could not be processed.
   This usually means your bank details need updating.
   [Update bank details →]
   
   If your details are correct, our team will
   resolve this within 24 hours."
         │
         ▼
Admin options in /admin/orders:
  [RETRY PAYOUT] — calls transfer API again
  [UPDATE CREATOR BANK] — contacts creator for new details
  [MANUAL TRANSFER] — admin does bank transfer outside Paystack
  [MARK AS PAID] — admin confirms manual payment was made
```

### Admin retry:

```typescript
// POST /api/admin/orders/[ref]/retry-payout
export async function POST(req: Request) {
  await requireAdmin(req);
  const reference = getParamFromUrl(req, 'ref');

  const { data: booking } = await supabase
    .from('bookings')
    .select('*')
    .eq('reference', reference)
    .eq('payout_status', 'failed')
    .single();

  if (!booking) return Response.json({ error: 'Order not found or not failed' }, { status: 404 });

  // Retry payout
  const result = await triggerCreatorPayout(booking.id);

  return Response.json({
    success: result.success,
    message: result.success ? 'Payout retry initiated' : result.error,
  });
}
```

---

## Paystack Balance Management

### Your Paystack balance:

```
Client pays R43,225 → Paystack holds it
Paystack settles to your FNB account in 2 business days

For payouts to creators, money must be IN your Paystack balance.

Two options:

OPTION A — Keep money in Paystack balance (recommended for start):
  Don't auto-settle to bank
  Paystack balance grows as clients pay
  Payouts come from this balance
  You withdraw your commission manually

OPTION B — Auto-settle + top-up:
  Paystack auto-settles to your FNB daily
  When payout needed, top up Paystack balance via EFT
  Top-up fee: 1% per transaction
  More complex but you have cash in your bank
```

**Start with Option A.** Let the money sit in Paystack. Payouts happen from the same balance. Withdraw your commission weekly or monthly.

### Check balance before payout:

```typescript
// Before transferring, verify you have enough balance
async function checkPaystackBalance(): Promise<number> {
  const response = await fetch('https://api.paystack.co/balance', {
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    },
  });
  const data = await response.json();
  // Returns balance in kobo — convert to ZAR
  return data.data[0].balance / 100;
}

// In triggerCreatorPayout, add:
const balance = await checkPaystackBalance();
if (balance < booking.creator_amount) {
  // Not enough balance — notify admin
  return { success: false, error: 'Insufficient Paystack balance' };
}
```

---

## Tax Considerations

### Platform responsibility:

```
ThabangVision is registered as a Pty Ltd.
Commission income (15%) is taxable business income.
VAT is charged on production services (included in package price).
Platform must issue invoices for its services.
```

### Creator responsibility:

```
Creators are independent contractors, NOT employees.
They are responsible for their own:
  - Income tax on earnings
  - VAT registration (if turnover > R1 million)
  - Tax returns

Platform provides:
  - Annual earnings statement (downloadable from dashboard)
  - Per-order payment receipts
  - Does NOT withhold tax from payouts
```

### Creator earnings statement:

```
ANNUAL EARNINGS STATEMENT
ThabangVision Studio (Pty) Ltd
Reg: 2025/742948/07

Creator: Thabang Mokwena
Period: 1 March 2026 — 28 February 2027

Total orders completed: 23
Total gross earnings: R284,500
Platform commission (15%): R42,675
Total paid out: R241,825

This statement is for your records. You are responsible
for declaring this income to SARS. ThabangVision does
not withhold tax on creator payouts.
```

Add a downloadable statement to `/dashboard/earnings`:

```
[DOWNLOAD ANNUAL STATEMENT — PDF]
```

---

## Minimum Payout Threshold

```
No minimum for now.

If a client pays R1,500 for a portrait session:
  Creator earns: R1,275
  That's worth paying out.

Add a minimum later if micro-transactions become an issue:
  e.g., minimum payout R500
  Smaller amounts accumulate until threshold reached
```

---

## Database Additions

```sql
-- Add to profiles for bank details
alter table profiles add column if not exists paystack_recipient_code text;
alter table profiles add column if not exists bank_name text;
alter table profiles add column if not exists bank_last4 text;
alter table profiles add column if not exists bank_verified boolean default false;

-- Remove raw bank columns if they exist (security)
alter table profiles drop column if exists bank_account_number;
alter table profiles drop column if exists bank_branch_code;
alter table profiles drop column if exists bank_account_type;

-- Bookings payout columns (already in client payment skill)
-- payout_status, payout_reference, paid_out_at
```

---

## API Routes

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| POST | /api/dashboard/bank-details | Creator | Save bank details via Paystack |
| GET | /api/dashboard/earnings | Creator | Earnings overview + history |
| GET | /api/dashboard/earnings/statement | Creator | Download annual statement PDF |
| POST | /api/admin/orders/[ref]/retry-payout | Admin | Retry failed payout |
| POST | /api/admin/orders/[ref]/manual-payout | Admin | Mark as manually paid |
| GET | /api/admin/payouts | Admin | All payout history |
| GET | /api/admin/paystack-balance | Admin | Check Paystack balance |

---

## Email Notifications

```
PAYOUT PROCESSING:
  Creator: "Your work has been approved! Payout of R{amount} is being processed."

PAYOUT SUCCESS:
  Creator: "R{amount} has been sent to {bank_name} ****{last4}. 
            Reference: {payout_ref}"

PAYOUT FAILED:
  Creator: "Your payout of R{amount} could not be processed. 
            Please update your bank details: [link]"
  Admin: "Payout failed for order #{ref}. Creator: {name}. 
          Amount: R{amount}. Action needed."

BANK DETAILS MISSING:
  Creator: "Your work was approved but you haven't added bank details.
            Add them now to receive R{amount}: [link]"

AUTO-APPROVE + PAYOUT:
  Client: "Your order was auto-approved after 7 days."
  Creator: "Order auto-approved. Payout of R{amount} is being processed."

MONTHLY STATEMENT:
  Creator: "Your earnings statement for {month} is ready.
            Total earned: R{amount}. [View dashboard]"
```

---

## Admin Payout Dashboard

### `/admin/payouts`

```
PAYOUTS
──────

Summary:
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│ R156,200   │ │ R24,300    │ │ R2,400     │ │ R183,900   │
│ Paid out   │ │ Processing │ │ Failed     │ │ Paystack   │
│ this month │ │            │ │            │ │ balance    │
└────────────┘ └────────────┘ └────────────┘ └────────────┘

Tabs: [All] [Processing] [Paid] [Failed]

┌──────────────────────────────────────────────────────┐
│ DATE       ORDER          CREATOR      AMOUNT  STATUS│
│──────────────────────────────────────────────────────│
│ 6 Apr      #BK-a8f3k2m9  Thabang M.  R36,741 ✅ Paid│
│ 5 Apr      #BK-r5t8w1x3  Kagiso S.    R8,500 ❌ Fail│
│            [RETRY]  [MANUAL TRANSFER]                │
│ 2 Apr      #BK-k9d2f4n1  Thabang M.   R2,932 ✅ Paid│
└──────────────────────────────────────────────────────┘
```

---

## Security Rules

```
1. Creator NEVER sees client payment details
2. Creator sees ONLY their earnings (85% amount)
3. Raw bank details NEVER stored — Paystack recipient codes only
4. Bank details sent over HTTPS to Paystack API only
5. Payout references are unique — prevents double payouts
6. Balance check before every transfer attempt
7. Webhook signature verified on every Paystack callback
8. Admin can retry failed payouts but cannot change amounts
9. Earnings statements show totals only — no client identifiers
10. All payout actions logged for audit trail
```

---

## Key Rules

```
1. AUTO-PAYOUT — client approves → creator gets paid automatically
2. NO ADMIN STEP — admin only handles failures and disputes  
3. 85/15 SPLIT ON GROSS — creator gets 85% of what client paid
4. RECIPIENT CODES — never store raw bank details
5. 7-DAY AUTO-APPROVE — unresponsive client → auto-approve → auto-payout
6. RETRY ON FAILURE — admin can retry, creator updates bank details
7. PAYSTACK BALANCE — keep money in Paystack for payouts
8. CREATOR DASHBOARD — full visibility of earnings and payout history
9. ANNUAL STATEMENT — downloadable for tax purposes
10. INDEPENDENT CONTRACTOR — creator handles their own tax
```
