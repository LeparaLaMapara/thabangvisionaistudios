# CLIENT PAYMENT PROCESS — Fiverr-Style Booking & Payment Flow

## Overview

ThabangVision uses a Fiverr-style payment model. Client pays upfront. Money is held until work is approved. Creator gets paid after client approval. Platform keeps 15% commission.

The client NEVER leaves ThabangVision. Payment happens inline via Paystack popup on the platform page.

---

## Payment Principles

```
1. Client pays UPFRONT before any work starts
2. Money is HELD in platform's Paystack account (escrow)
3. Creator DELIVERS the work through the platform
4. Client REVIEWS and APPROVES (or requests revision)
5. Payment RELEASED to creator after approval
6. Platform keeps 15% commission
7. Client never leaves the platform — Paystack inline checkout
8. No raw banking data stored — Paystack handles all sensitive info
```

---

## Complete Client Journey

### STEP 1 — Client Selects Package

Client browses `/smart-production` and finds a package.

Each package shows three tiers (like Fiverr Basic/Standard/Premium):

```
┌─────────────┐ ┌───────────────┐ ┌──────────────┐
│ ESSENTIALS   │ │ PREMIUM    ⭐ │ │ ULTIMATE     │
│              │ │               │ │              │
│ 6 hours      │ │ 10 hours      │ │ Full day     │
│ Photo only   │ │ Photo + Video │ │ Photo + Film │
│              │ │               │ │ + Drone      │
│ ✓ 150 photos │ │ ✓ 300 photos  │ │ ✓ 500 photos │
│ ✓ Gallery    │ │ ✓ Highlight   │ │ ✓ Full film  │
│              │ │ ✓ Full edit   │ │ ✓ Highlight  │
│              │ │ ✓ Gallery+USB │ │ ✓ Album      │
│              │ │               │ │ ✓ Drone      │
│              │ │               │ │              │
│ Delivery:    │ │ Delivery:     │ │ Delivery:    │
│ 7 days       │ │ 14 days       │ │ 21 days      │
│              │ │               │ │              │
│ Revisions:   │ │ Revisions:    │ │ Revisions:   │
│ 1 round      │ │ 2 rounds      │ │ 3 rounds     │
│              │ │               │ │              │
│ R12,650      │ │ R38,525       │ │ R65,000      │
│              │ │               │ │              │
│ [SELECT]     │ │ [SELECT] ←    │ │ [SELECT]     │
└─────────────┘ └───────────────┘ └──────────────┘
```

### STEP 2 — Client Adds Extras (Optional)

After selecting a tier, client can add extras:

```
── ADD EXTRAS (OPTIONAL) ──

[ ] Drone coverage                              +R3,200
[ ] Extra hour of coverage                      +R2,850
[ ] Same-day sneak peek (5 edited photos)       +R1,500
[ ] Printed album (30 pages, hardcover)          +R4,500
[ ] Second photographer/videographer per hour    +R1,500
[ ] Express delivery (half the delivery time)    +R2,500

── ORDER SUMMARY ──

Wedding Premium:                    R38,525
+ Drone coverage:                    R3,200
+ Same-day sneak peek:               R1,500
                                   ────────
Total:                              R43,225

[CONTINUE — R43,225]
```

### STEP 3 — Auth Gate

When client clicks [CONTINUE]:

```
IF NOT LOGGED IN:
  → Redirect to /login?redirect=/book?package=wedding-premium&extras=drone-coverage,same-day-sneak-peek
  
  Login page shows:
  ┌─────────────────────────────────┐
  │ SIGN IN TO COMPLETE YOUR ORDER  │
  │                                 │
  │ [G  SIGN IN WITH GOOGLE]        │
  │                                 │
  │ ── or ──                        │
  │                                 │
  │ [Enter email]                   │
  │ [SEND ME A SIGN IN LINK]        │
  │                                 │
  │ Your order:                     │
  │ Wedding Premium + extras        │
  │ R43,225 (saved for you)         │
  └─────────────────────────────────┘

  After login → redirect back to /book with all params preserved
  First-time user → onboarding (name only) → redirect to /book

IF LOGGED IN:
  → Go straight to /book page
```

### STEP 4 — Order Details & Payment

```
/book?package=wedding-premium&extras=drone-coverage,same-day-sneak-peek

┌─────────────────────────────────────────────────┐
│ COMPLETE YOUR ORDER                              │
│                                                   │
│ ── YOUR DETAILS ──                               │
│ Name: Ntando Mashinini          (from account)    │
│ Email: ntando@email.com         (from account)    │
│ Phone: 082 xxx xxxx             (from account)    │
│                                                   │
│ ── PROJECT DETAILS ──                            │
│                                                   │
│ Event date *                                      │
│ [📅 22 March 2026                    ]            │
│                                                   │
│ Event location *                                  │
│ [Sandton, Johannesburg               ]            │
│                                                   │
│ Brief for your creator *                          │
│ [                                                 │
│   150 guest wedding at garden venue.              │
│   Ceremony 2pm, reception until 10pm.             │
│   Romantic, cinematic style.                       │
│ ]                                    min 20 chars  │
│                                                   │
│ Any specific requirements? (optional)             │
│ [                                                 │
│   Drone shots of venue would be great.            │
│ ]                                                 │
│                                                   │
│ ── ORDER SUMMARY ──                              │
│                                                   │
│ Wedding Premium                      R38,525      │
│   ✓ 10 hours coverage                             │
│   ✓ 300 edited photos                             │
│   ✓ 3-min highlight reel                          │
│   ✓ Full ceremony edit                            │
│   ✓ Online gallery + USB                          │
│   ✓ 2 revision rounds                             │
│                                                   │
│ Extras:                                           │
│   Drone coverage                      R3,200      │
│   Same-day sneak peek                 R1,500      │
│                                                   │
│ ─────────────────────────────────────             │
│ Total:                               R43,225      │
│                                                   │
│ Delivery: 14 working days after shoot             │
│                                                   │
│ [PAY R43,225]                                     │
│                                                   │
│ 🔒 Your payment is held securely until            │
│    you approve the delivered work.                 │
│                                                   │
│ Free cancellation up to 48hrs before event.       │
│ By ordering you agree to our Terms of Service.    │
└─────────────────────────────────────────────────┘
```

### STEP 5 — Paystack Inline Payment

Client clicks [PAY R43,225]:

```
Paystack popup appears OVER your page.
Client enters card details in the popup.
Client NEVER leaves thabangvision.com.

┌─────────────────────────────────────────────────┐
│ YOUR PAGE (dimmed behind popup)                  │
│                                                   │
│   ┌───────────────────────────────────┐           │
│   │         PAYSTACK CHECKOUT         │           │
│   │                                   │           │
│   │  Pay ThabangVision Studio         │           │
│   │  R43,225.00                       │           │
│   │                                   │           │
│   │  Card number                      │           │
│   │  [                            ]   │           │
│   │                                   │           │
│   │  Expiry        CVV               │           │
│   │  [MM/YY]       [***]              │           │
│   │                                   │           │
│   │  [PAY R43,225.00]                 │           │
│   │                                   │           │
│   │  🔒 Secured by Paystack          │           │
│   └───────────────────────────────────┘           │
│                                                   │
└─────────────────────────────────────────────────┘
```

**Frontend implementation:**

```typescript
// Load Paystack inline script in _document.tsx or layout:
// <script src="https://js.paystack.co/v2/inline.js"></script>

function payWithPaystack(order: {
  reference: string;
  total: number;
  email: string;
  bookingId: string;
}) {
  const handler = PaystackPop.setup({
    key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY!,
    email: order.email,
    amount: Math.round(order.total * 100), // convert to kobo/cents
    currency: 'ZAR',
    ref: order.reference,
    metadata: {
      booking_id: order.bookingId,
      custom_fields: [
        {
          display_name: 'Package',
          variable_name: 'package',
          value: 'Wedding Premium',
        },
      ],
    },

    // Payment successful — popup auto-closes
    callback: (response: { reference: string }) => {
      // Verify payment on server
      verifyPaymentOnServer(response.reference);
      // Update UI to show confirmation
      setOrderStatus('confirmed');
    },

    // User closed popup without paying
    onClose: () => {
      // Order stays as 'pending' — client can try again
      showMessage('Payment cancelled. Your order is saved — you can pay anytime.');
    },
  });

  handler.openIframe();
}
```

**Server-side — create order + initialize payment:**

```typescript
// POST /api/orders
export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return Response.json({ error: 'Must be logged in' }, { status: 401 });

  const body = await req.json();
  const { packageId, extras, eventDate, location, brief, requirements } = body;

  // Look up package from constants
  const pkg = PRODUCTION_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return Response.json({ error: 'Package not found' }, { status: 400 });

  // Calculate package price
  const packagePrice = calculatePackagePrice(pkg);

  // Calculate extras
  const selectedExtras = PRODUCTION_ADDONS.filter(a => extras?.includes(a.id));
  const extrasTotal = selectedExtras.reduce((sum, addon) => sum + addon.price, 0);

  // Total
  const total = packagePrice.total + extrasTotal;

  // Generate unique reference
  const reference = `BK-${nanoid(10)}`;

  // Calculate commission split
  const platformAmount = Math.round(total * (BOOKING.platformCommission / 100));
  const creatorAmount = total - platformAmount;

  // Create order in database
  const { data: order, error } = await supabase.from('bookings').insert({
    reference,
    client_id: user.id,
    client_email: user.email,
    booking_type: 'production',
    package_id: packageId,
    package_name: pkg.name,
    extras: selectedExtras.map(e => e.id),
    extras_total: extrasTotal,
    event_date: eventDate,
    location,
    brief,
    requirements,
    subtotal: packagePrice.subtotal + extrasTotal,
    vat: packagePrice.vat,
    total,
    platform_commission: BOOKING.platformCommission,
    platform_amount: platformAmount,
    creator_amount: creatorAmount,
    delivery_days: pkg.deliveryDays || 14,
    max_revisions: pkg.revisions || 2,
    status: 'pending',
    payment_status: 'unpaid',
    cancellation_deadline: new Date(new Date(eventDate).getTime() - 48 * 60 * 60 * 1000).toISOString(),
  }).select().single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    success: true,
    order: {
      id: order.id,
      reference,
      total,
      email: user.email,
    },
  });
}
```

### STEP 6 — Order Confirmed (instant)

After successful payment, popup closes and page shows:

```
┌─────────────────────────────────────────────────┐
│ ✓ ORDER CONFIRMED                                │
│                                                   │
│ Order #BK-a8f3k2m9                               │
│ Wedding Premium + Extras                          │
│ Amount paid: R43,225                              │
│                                                   │
│ ── WHAT HAPPENS NEXT ──                          │
│                                                   │
│ ① We'll assign your creator        within 24hrs  │
│ ② Creator reviews your brief       within 48hrs  │
│ ③ Your shoot happens              22 March 2026   │
│ ④ Deliverables sent to you         14 working days│
│ ⑤ You review and approve           7 days to review│
│ ⑥ Creator gets paid               after approval  │
│                                                   │
│ Your payment is held securely until you approve    │
│ the delivered work.                                │
│                                                   │
│ [VIEW MY ORDERS]  [BACK TO HOME]                  │
└─────────────────────────────────────────────────┘
```

**Emails sent at this point:**

```
TO CLIENT:
  Subject: "Order confirmed — #BK-a8f3k2m9"
  Body: "Your Wedding Premium order has been confirmed.
         Amount: R43,225
         Event: 22 March 2026, Sandton
         We'll assign your creator within 24 hours.
         Track your order: [link to dashboard]"

TO ADMIN:
  Subject: "New paid order — Wedding Premium — R43,225"
  Body: "Client: Ntando Mashinini
         Package: Wedding Premium + Drone + Sneak Peek
         Event: 22 March 2026, Sandton
         Total: R43,225
         Creator payout: R36,741.25
         Platform commission: R6,483.75
         Brief: [client's brief]
         Action needed: Assign a creator"
```

### STEP 7 — Webhook Confirmation (background)

```typescript
// POST /api/webhooks/paystack
export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('x-paystack-signature');

  // Verify webhook is from Paystack
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
      const amount = event.data.amount / 100;

      // Update order
      await supabase.from('bookings').update({
        payment_status: 'paid',
        status: 'pending', // paid but awaiting creator assignment
        paid_at: new Date().toISOString(),
        paystack_reference: reference,
      }).eq('reference', reference);

      // Send notifications (emails)
      await sendOrderConfirmationEmails(reference);

      break;
    }

    case 'charge.failed': {
      const reference = event.data.reference;
      await supabase.from('bookings').update({
        payment_status: 'failed',
      }).eq('reference', reference);
      break;
    }

    case 'transfer.success': {
      const reference = event.data.reference;
      await supabase.from('bookings').update({
        payout_status: 'paid',
        status: 'paid_out',
        paid_out_at: new Date().toISOString(),
      }).eq('payout_reference', reference);

      // Email creator: "Payment received!"
      await sendPayoutConfirmationEmail(reference);
      break;
    }

    case 'transfer.failed': {
      const reference = event.data.reference;
      await supabase.from('bookings').update({
        payout_status: 'failed',
      }).eq('payout_reference', reference);

      // Email admin: "Payout failed — check creator bank details"
      await sendPayoutFailedEmail(reference);
      break;
    }

    case 'refund.processed': {
      const reference = event.data.transaction.reference;
      await supabase.from('bookings').update({
        status: 'refunded',
        refund_amount: event.data.amount / 100,
      }).eq('reference', reference);
      break;
    }
  }

  return Response.json({ received: true });
}
```

---

## Order Tracking — Client Dashboard

### Orders list: `/dashboard/orders`

```
YOUR ORDERS

┌──────────────────────────────────────────┐
│ #BK-a8f3k2m9                            │
│ Wedding Premium + Extras    ✅ CONFIRMED │
│ 22 March 2026 | Sandton                 │
│ Creator: Thabang M.                      │
│ Total: R43,225                           │
│ Delivery expected: 5 April 2026          │
│ [VIEW ORDER]                             │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│ #BK-k9d2f4n1                            │
│ Portrait Session           📦 DELIVERED  │
│ 15 March 2026 | Braamfontein            │
│ Creator: Kagiso S.                       │
│ Total: R3,450                            │
│ [REVIEW & APPROVE]                       │
└──────────────────────────────────────────┘
```

### Order detail: `/dashboard/orders/[reference]`

Full order timeline with all status updates, creator info, delivery links, and action buttons (approve/revision/cancel).

---

## Delivery & Approval Flow

### Creator delivers work

Creator goes to `/dashboard/orders/[reference]/deliver`:

```
DELIVER YOUR WORK

Order #BK-a8f3k2m9
Wedding Premium for Ntando M.

How to deliver:
Upload a link to the client's gallery or files.

Gallery/download link *
[https://drive.google.com/folder/wedding-ntando]

Message to client (optional):
[
  Hi! Here are your wedding photos and highlight reel.
  The gallery has 312 edited photos and the video files.
  Let me know if you'd like any changes!
]

[DELIVER ORDER]
```

After delivery:
- Order status → `delivered`
- Client receives email: "Your order has been delivered! Review and approve."
- Auto-approve timer starts: 7 days
- `auto_approve_at` = `delivered_at + 7 days`

### Client reviews delivery

Client sees in dashboard:

```
ORDER #BK-a8f3k2m9              STATUS: DELIVERED

── DELIVERY ──

From: Thabang M.
Date: 4 April 2026
Message: "Hi! Here are your wedding photos and highlight reel..."

Gallery: [View Gallery ↗]

── WHAT WOULD YOU LIKE TO DO? ──

[✓ APPROVE & RELEASE PAYMENT]

[↻ REQUEST REVISION] (2 of 2 remaining)

⏰ This order will be auto-approved on 11 April 2026
   if no action is taken.
```

### Client approves

Client clicks [APPROVE & RELEASE PAYMENT]:

```
RATE YOUR EXPERIENCE

How was your experience with Thabang M.?

⭐⭐⭐⭐⭐  (click to rate)

Write a review:
[
  Thabang captured our wedding beautifully.
  Professional, on time, and the final edit
  was stunning. Highly recommend!
]

Would you recommend ThabangVision to a friend?
( ) Yes  ( ) No

[SUBMIT REVIEW & RELEASE PAYMENT]
```

After submit:
- Order status → `completed`
- Rating saved to booking
- Admin notified: "Order complete — ready for payout"
- Admin triggers payout (or auto-payout if configured)
- Creator receives email: "You got a 5-star review!"

### Client requests revision

Client clicks [REQUEST REVISION]:

```
REQUEST A REVISION

Tell the creator what you'd like changed:
[
  The colour grading feels too warm on the
  ceremony photos. Could you make them more
  natural? Also the highlight reel is missing
  the first dance moment.
]

Revisions remaining after this: 1 of 2

[SEND REVISION REQUEST]
```

After submit:
- Order status → `revision`
- Creator receives email: "Revision requested for order #BK-a8f3k2m9"
- Creator makes changes in their dashboard
- Creator re-delivers
- Client reviews again
- Cycle repeats up to max_revisions times

If revisions exhausted:
```
"You've used all included revisions.
 Additional revisions are charged at R650/hr.
 [REQUEST PAID REVISION — R650/hr]
 [APPROVE CURRENT DELIVERY]"
```

---

## Cancellation Policy

### Before 48 hours of event:

```
Client clicks [CANCEL ORDER]

"Are you sure you want to cancel?

Your order: Wedding Premium — R43,225
Event date: 22 March 2026
Cancellation deadline: 20 March 2026

✅ Full refund — you're cancelling more than
   48 hours before your event.

[CONFIRM CANCELLATION]  [KEEP MY ORDER]"
```

After cancel:
- Order status → `cancelled`
- Paystack refund API called → full refund
- Client email: "Order cancelled. Refund of R43,225 processed."
- Creator email: "Order cancelled by client."
- Admin email: "Order #BK-a8f3k2m9 cancelled and refunded."

### Within 48 hours of event:

```
"⚠️ Late cancellation

Your event is within 48 hours.
A 50% cancellation fee applies.

Refund amount: R21,612.50
Fee retained: R21,612.50

[CONFIRM CANCELLATION]  [KEEP MY ORDER]
[CONTACT SUPPORT] for exceptional circumstances"
```

### After event date / after delivery:

```
"This order cannot be cancelled.
The event has passed or work has been delivered.

If you have an issue with the delivered work,
please request a revision or contact support.

[REQUEST REVISION]  [CONTACT SUPPORT]"
```

---

## Refund Flow

### Full refund (admin-triggered):

```typescript
// POST /api/admin/orders/[id]/refund
async function refundOrder(orderId: string, amount?: number) {
  const { data: order } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', orderId)
    .single();

  // Call Paystack refund API
  const response = await fetch('https://api.paystack.co/refund', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transaction: order.paystack_reference,
      amount: amount ? Math.round(amount * 100) : undefined, // partial or full
    }),
  });

  const data = await response.json();

  // Update order
  await supabase.from('bookings').update({
    status: 'refunded',
    refund_amount: amount || order.total,
    refund_reference: data.data?.transaction?.reference,
  }).eq('id', orderId);

  // Email client: "Refund processed"
  // Refund goes back to original payment method automatically
}
```

Paystack refunds to the SAME method the client used to pay:
- Card payment → refund to same card
- Bank transfer → refund to same bank account
- No client banking info needed by you

---

## Financial Calculations

### Commission split:

```
Client pays:                 R43,225.00
Paystack fee (2.9% + R1):  -R1,254.53
VAT on fee (15%):            -R188.18
────────────────────────────────────────
Platform receives:           R41,782.29

Platform commission (15%):    R6,483.75
Creator payout (85%):        R36,741.25

Platform net after fees:     R6,483.75 - R1,442.71 (proportional fees) = R5,041.04
Effective commission:        ~11.7%
```

### Display to creator:

```
Creator sees in their dashboard:

"You'll earn: R36,741.25"
"Platform commission: 15%"

Creator does NOT see:
- Paystack fees
- Platform net calculation
- Client's payment details
```

### Pricing principle:

```
OPTION A — Split on gross (creator-friendly) ← RECOMMENDED:
  Creator gets 85% of R43,225 = R36,741.25
  Platform absorbs Paystack fees
  Simple: "You keep 85% of what the client pays"

OPTION B — Split on net (platform-friendly):
  Creator gets 85% of R41,782.29 = R35,515.05
  Fees shared proportionally
  Complex: harder to explain
```

**Use Option A.** Simpler to communicate. Creators understand "85% is mine."

---

## Paystack Configuration

### Environment variables:

```
PAYSTACK_SECRET_KEY=sk_test_xxxxx        # server-side only
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_test_xxxxx  # client-side (for inline JS)
```

### Paystack dashboard settings:

```
Business name: ThabangVision Studio (Pty) Ltd
Currency: ZAR
Webhook URL: https://thabangvision.com/api/webhooks/paystack
Callback URL: https://thabangvision.com/api/orders/callback (fallback)

Channels enabled:
  ✓ Card
  ✓ Bank Transfer
  ✓ EFT
  ✓ USSD
```

### Script loading:

```html
<!-- Add to app layout or _document -->
<script src="https://js.paystack.co/v2/inline.js"></script>
```

### Paystack inline type declaration:

```typescript
// types/paystack.d.ts
interface PaystackPopInterface {
  setup(options: {
    key: string;
    email: string;
    amount: number;
    currency: string;
    ref: string;
    metadata?: Record<string, any>;
    callback: (response: { reference: string }) => void;
    onClose: () => void;
  }): { openIframe: () => void };
}

declare const PaystackPop: PaystackPopInterface;
```

---

## Order Statuses

```
pending        Client created order but hasn't paid yet
paid           Payment confirmed via webhook
assigned       Admin assigned a creator
accepted       Creator accepted the order
in_progress    Shoot date has passed, work is being done
delivered      Creator uploaded deliverables
revision       Client requested changes
completed      Client approved delivery, payment released
paid_out       Creator received their bank transfer
cancelled      Order cancelled (refund if applicable)
refunded       Refund processed back to client
disputed       Client raised an issue with admin
```

### Status transitions:

```
pending → paid (webhook: charge.success)
paid → assigned (admin assigns creator)
assigned → accepted (creator clicks accept)
accepted → in_progress (auto: after event date)
in_progress → delivered (creator uploads deliverables)
delivered → completed (client approves)
delivered → revision (client requests changes)
revision → delivered (creator re-delivers)
completed → paid_out (admin triggers payout, webhook: transfer.success)

Cancellation:
pending → cancelled (client cancels before payment)
paid → cancelled + refunded (client cancels, full/partial refund)
assigned → cancelled + refunded (before creator accepts)

Edge cases:
delivered → completed (auto: 7 days after delivery with no response)
paid → cancelled (auto: 72 hours with no creator assigned — refund)
any → disputed (client contacts support)
```

---

## Auto-Actions (Cron Jobs)

```
DAILY CRON — /api/cron/order-maintenance:

1. Auto-approve delivered orders after 7 days:
   WHERE status = 'delivered'
   AND auto_approve_at < NOW()
   → Set status = 'completed'
   → Email client: "Your order was auto-approved"
   → Notify admin to trigger payout

2. Auto-cancel unpaid orders after 72 hours:
   WHERE status = 'pending'
   AND payment_status = 'unpaid'
   AND created_at < NOW() - INTERVAL '72 hours'
   → Set status = 'cancelled'
   → Email client: "Your order expired. Book again anytime."

3. Reminder: unassigned paid orders after 12 hours:
   WHERE status = 'paid'
   AND created_at < NOW() - INTERVAL '12 hours'
   → Email admin: "Unassigned order #BK-xxx — assign a creator!"

4. Reminder: undelivered orders past delivery date:
   WHERE status IN ('accepted', 'in_progress')
   AND event_date + delivery_days < NOW()
   → Email admin: "Order #BK-xxx is overdue for delivery"
   → Email creator: "Your delivery for #BK-xxx is overdue"
```

---

## Email Notifications

### At each status change:

```
pending → paid:
  CLIENT: "Order confirmed! Ref: #BK-xxx. We're assigning your creator."
  ADMIN:  "New paid order — [package] — R[total]. Assign a creator."

paid → assigned:
  CLIENT: "Your creator is [name]. They'll review your brief shortly."
  CREATOR: "New order assigned! [package] for [event date]. Review and accept."

assigned → accepted:
  CLIENT: "[Creator name] accepted your order! Your shoot is confirmed for [date]."

in_progress → delivered:
  CLIENT: "Your order has been delivered! Review and approve: [link]"

delivered → completed:
  ADMIN: "Order #BK-xxx approved by client. Trigger payout: R[creator_amount]."
  CREATOR: "Great news! Client approved your work. Payment incoming."

completed → paid_out:
  CREATOR: "R[amount] has been sent to your [bank] ****[last4]. Ref: [payout_ref]"

cancelled:
  CLIENT: "Order cancelled. Refund of R[amount] is being processed."
  CREATOR: "Order #BK-xxx has been cancelled."
  ADMIN: "Order #BK-xxx cancelled. Refund: R[amount]."

revision:
  CREATOR: "Client requested changes: [revision notes]. Please re-deliver."
```

---

## Database Schema

```sql
-- Orders/bookings table (updated for Fiverr-style flow)
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,

  -- Who
  client_id uuid references auth.users(id) not null,
  client_email text not null,
  creator_id uuid references profiles(id),

  -- What
  booking_type text not null check (booking_type in ('production', 'rental', 'crew')),
  package_id text,
  package_name text,
  extras text[] default '{}',
  extras_total integer default 0,

  -- When & Where
  event_date date,
  location text,
  brief text,
  requirements text,

  -- Money
  subtotal integer not null,
  vat integer not null,
  total integer not null,
  platform_commission integer not null default 15,
  platform_amount integer not null,
  creator_amount integer not null,

  -- Payment
  payment_status text default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'failed', 'refunded')),
  paystack_reference text,
  paid_at timestamptz,

  -- Delivery
  delivery_url text,
  delivery_message text,
  delivery_days integer default 14,
  delivered_at timestamptz,
  max_revisions integer default 2,
  revision_count integer default 0,
  revision_notes text,
  auto_approve_at timestamptz,

  -- Creator payout
  payout_status text default 'pending'
    check (payout_status in ('pending', 'processing', 'paid', 'failed')),
  payout_reference text,
  paid_out_at timestamptz,

  -- Status
  status text default 'pending'
    check (status in (
      'pending', 'paid', 'assigned', 'accepted', 'in_progress',
      'delivered', 'revision', 'completed', 'paid_out',
      'cancelled', 'refunded', 'disputed'
    )),

  -- Rating
  client_rating integer check (client_rating >= 1 and client_rating <= 5),
  client_review text,

  -- Cancellation
  cancellation_deadline timestamptz,
  cancellation_reason text,
  refund_amount integer,
  refund_reference text,

  -- Dispute
  disputed_at timestamptz,
  dispute_reason text,

  -- Admin
  admin_notes text,

  -- Timestamps
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  assigned_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);

-- Indexes
create index idx_bookings_status on bookings (status);
create index idx_bookings_client on bookings (client_id);
create index idx_bookings_creator on bookings (creator_id);
create index idx_bookings_reference on bookings (reference);
create index idx_bookings_auto_approve on bookings (auto_approve_at)
  where status = 'delivered';

-- RLS
alter table bookings enable row level security;

create policy "Clients view own orders" on bookings
  for select using (auth.uid() = client_id);

create policy "Creators view assigned orders" on bookings
  for select using (auth.uid() = creator_id);

create policy "Authenticated users create orders" on bookings
  for insert with check (auth.uid() = client_id);

create policy "Users update own orders" on bookings
  for update using (auth.uid() = client_id or auth.uid() = creator_id);

create policy "Admin manages all" on bookings
  for all using (true);
```

---

## API Routes

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| POST | /api/orders | Client | Create order |
| GET | /api/orders | Client | List own orders |
| GET | /api/orders/[ref] | Client/Creator | Order detail |
| PATCH | /api/orders/[ref]/approve | Client | Approve delivery |
| PATCH | /api/orders/[ref]/revision | Client | Request revision |
| PATCH | /api/orders/[ref]/cancel | Client | Cancel order |
| POST | /api/orders/[ref]/review | Client | Submit rating |
| PATCH | /api/orders/[ref]/deliver | Creator | Upload deliverables |
| PATCH | /api/orders/[ref]/accept | Creator | Accept order |
| PATCH | /api/orders/[ref]/decline | Creator | Decline order |
| POST | /api/webhooks/paystack | Public | Paystack webhook |
| GET | /api/admin/orders | Admin | All orders |
| PATCH | /api/admin/orders/[ref]/assign | Admin | Assign creator |
| POST | /api/admin/orders/[ref]/payout | Admin | Trigger payout |
| POST | /api/admin/orders/[ref]/refund | Admin | Process refund |

---

## Security Rules

```
1. Client NEVER sees: creator email, phone, bank details, other orders
2. Creator NEVER sees: client email, phone, payment details
3. Creator sees: project brief, dates, location, their earnings
4. Admin sees: everything
5. Payment data: Paystack handles all card/bank data
6. Webhook verification: HMAC-SHA512 on every webhook
7. Rate limiting: 5 orders per hour per user
8. CSRF: all order routes check origin
9. Auth: all routes except webhook require authentication
10. Idempotency: unique reference prevents double payments
```

---

## Key Rules

```
1. FIXED PACKAGE PRICES — what client sees is what they pay
2. INLINE PAYMENT — Paystack popup, client never leaves platform
3. ESCROW MODEL — money held until client approves
4. 85/15 SPLIT — creator keeps 85%, platform keeps 15%
5. SPLIT ON GROSS — "85% of what client paid" not "85% after fees"
6. AUTO-APPROVE — 7 days after delivery if client doesn't respond
7. AUTO-CANCEL — 72 hours if order not paid
8. MAX 2 REVISIONS — included in package, extras charged hourly
9. 48HR CANCELLATION — free before, 50% fee after
10. NO RAW BANK DATA — Paystack recipient codes only
```
