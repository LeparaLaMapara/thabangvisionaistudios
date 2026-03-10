# Payment Abstraction Layer

## Overview

The payment system uses a **provider abstraction** pattern that allows switching between payment gateways (PayFast, Paystack, or future providers) with a single environment variable. All checkout, subscription, and webhook logic goes through a unified interface defined in `lib/payments/`.

---

## Architecture

```
lib/payments/
  types.ts      - Shared types and PaymentProvider interface
  payfast.ts    - PayFast adapter (wraps lib/payfast.ts)
  paystack.ts   - Paystack adapter (direct API calls)
  index.ts      - Provider registry + env-based selection
```

### How Provider Selection Works

```
PAYMENT_PROVIDER env var
        |
        v
  index.ts reads env var (defaults to "payfast")
        |
        v
  Looks up in providers registry: { payfast, paystack }
        |
        v
  Exports the matched provider as `payments`
```

All API routes import from `@/lib/payments` and call `payments.createCheckout()`, `payments.createSubscriptionCheckout()`, or `payments.validateWebhook()`. They never reference a specific provider directly.

---

## The PaymentProvider Interface

Every provider implements this interface (`lib/payments/types.ts`):

```typescript
interface PaymentProvider {
  readonly name: string;
  readonly allowedHosts: readonly string[];

  isConfigured(): boolean;

  createCheckout(params: CheckoutParams): Promise<CheckoutResult>;
  createSubscriptionCheckout(params: SubscriptionCheckoutParams): Promise<CheckoutResult>;

  validateWebhook(request: {
    ip: string;
    body: string;
    headers: Record<string, string>;
  }): Promise<WebhookResult>;
}
```

### Key Types

| Type | Purpose |
|------|---------|
| `CheckoutParams` | One-time payment: paymentId, amount, itemName, email, returnUrl, cancelUrl, metadata |
| `SubscriptionCheckoutParams` | Subscription: subscriptionId, amount, planName, email, interval, returnUrl, cancelUrl, metadata |
| `CheckoutResult` | Contains `paymentUrl` - the URL to redirect the browser to |
| `WebhookResult` | Parsed webhook: valid, status, providerPaymentId, paymentId, amountGross, raw |
| `PaymentStatus` | `'COMPLETE' \| 'FAILED' \| 'PENDING'` |

---

## How Each Provider Works

### PayFast (`lib/payments/payfast.ts`)

**Checkout flow:** Builds a signed URL with query parameters. No server API call needed - the browser is redirected to PayFast's hosted checkout page with all payment data in the URL.

```
Client POST /api/bookings
  -> payments.createCheckout() builds URL with signature
  -> Returns URL like: https://sandbox.payfast.co.za/eng/process?merchant_id=...&amount=100.00&signature=abc123
  -> Client redirects browser to that URL
```

**Webhook flow:** PayFast sends a form-encoded POST (ITN) to your webhook endpoint. Validation includes:
1. IP address check (PayFast server IPs only)
2. MD5 signature verification
3. Server-to-server validation (calls PayFast's validate endpoint)

**Amounts:** Passed in ZAR (e.g., `100.00` for R100).

### Paystack (`lib/payments/paystack.ts`)

**Checkout flow:** Makes a server-side API call to `POST https://api.paystack.com/transaction/initialize` to create a transaction, then returns the `authorization_url` for the client to redirect to.

```
Client POST /api/bookings
  -> payments.createCheckout() calls Paystack API
  -> Paystack returns { authorization_url: "https://checkout.paystack.com/abc123" }
  -> Returns that URL to client
  -> Client redirects browser to that URL
```

**Webhook flow:** Paystack sends a JSON POST with an `x-paystack-signature` header (HMAC SHA-512). Validation:
1. Compute HMAC SHA-512 of the raw body using the secret key
2. Compare with the `x-paystack-signature` header using timing-safe comparison
3. Parse JSON body and extract event + payment data

**Amounts:** The interface accepts ZAR (e.g., `100.00`), but the Paystack adapter internally converts to cents (`100.00 * 100 = 10000`) before calling the API.

**Important:** Paystack requires an email address for all transactions. The `createCheckout` and `createSubscriptionCheckout` methods will throw if `email` is not provided.

---

## How to Switch Providers

### Step 1: Set the environment variable

In `.env.local`:

```env
# Options: payfast, paystack
PAYMENT_PROVIDER=paystack
```

### Step 2: Add provider credentials

For **PayFast**:
```env
PAYFAST_MERCHANT_ID=your_merchant_id
PAYFAST_MERCHANT_KEY=your_merchant_key
PAYFAST_PASSPHRASE=your_passphrase
NEXT_PUBLIC_PAYFAST_SANDBOX=true
```

For **Paystack**:
```env
PAYSTACK_SECRET_KEY=sk_test_xxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxx
```

### Step 3: Restart the dev server

The provider is resolved at module load time. A server restart is required after changing `PAYMENT_PROVIDER`.

That's it. No code changes required. All routes automatically use the selected provider.

---

## How Routes Use the Abstraction

### Creating a one-time payment (equipment booking)

From `app/api/bookings/route.ts`:

```typescript
import { payments } from '@/lib/payments';

// Check if provider is configured
if (payments.isConfigured() && totalPrice > 0) {
  const checkout = await payments.createCheckout({
    paymentId: booking.id,
    amount: totalPrice,
    itemName: `Rental: ${rental.title}`,
    itemDescription: `Booking ${start_date} to ${end_date}`,
    email: user.email,
    returnUrl: `/dashboard/bookings/${booking.id}?payment=success`,
    cancelUrl: `/dashboard/bookings/${booking.id}?payment=cancelled`,
    metadata: {
      customStr1: 'equipment_booking',
      customStr2: user.id,
      customStr3: rental_id,
    },
  });

  // Redirect user to checkout
  return NextResponse.json({ payment_url: checkout.paymentUrl });
}
```

### Creating a subscription payment

From `app/api/subscriptions/route.ts`:

```typescript
import { payments } from '@/lib/payments';

const checkout = await payments.createSubscriptionCheckout({
  subscriptionId: sub.id,
  amount: plan.price,
  planName: plan.name,
  planDescription: plan.description,
  email: user.email,
  returnUrl: '/dashboard?subscription=success',
  cancelUrl: '/pricing?subscription=cancelled',
  interval: plan.interval === 'year' ? 'annual' : 'monthly',
  metadata: {
    customStr1: 'subscription',
    customStr2: user.id,
    customStr3: plan_id,
  },
});
```

### Handling webhooks

From `app/api/webhooks/payfast/route.ts`:

```typescript
import { payments } from '@/lib/payments';

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const body = await request.text();

  const webhook = await payments.validateWebhook({
    ip,
    body,
    headers: Object.fromEntries(request.headers.entries()),
  });

  if (!webhook.valid) {
    return NextResponse.json({ error: 'Invalid' }, { status: 400 });
  }

  // webhook.status is 'COMPLETE' | 'FAILED' | 'PENDING'
  // webhook.paymentId is your internal ID (booking ID or subscription ID)
  // webhook.providerPaymentId is the provider's transaction ID
  // webhook.amountGross is the amount in ZAR
  // webhook.raw contains all provider-specific fields

  switch (webhook.status) {
    case 'COMPLETE':
      // Confirm booking or activate subscription
      break;
    case 'FAILED':
      // Cancel the pending record
      break;
  }

  return new NextResponse('OK', { status: 200 });
}
```

### Client-side redirect validation

Both the BookingWidget and Pricing page validate the checkout URL hostname before redirecting:

```typescript
const allowedHosts = [
  'sandbox.payfast.co.za',
  'www.payfast.co.za',
  'checkout.paystack.com',
];

const url = new URL(paymentUrl);
if (!allowedHosts.includes(url.hostname)) {
  throw new Error('Invalid payment URL');
}

window.location.href = paymentUrl;
```

---

## Adding a New Provider

1. Create `lib/payments/newprovider.ts` implementing the `PaymentProvider` interface
2. Register it in `lib/payments/index.ts`:
   ```typescript
   import { newprovider } from './newprovider';

   const providers: Record<string, PaymentProvider> = {
     payfast,
     paystack,
     newprovider,
   };
   ```
3. Add the provider's checkout hostname to client-side allowed hosts
4. Set `PAYMENT_PROVIDER=newprovider` in `.env.local`

The interface methods are async, so providers that need server API calls (like Paystack) and those that don't (like PayFast) both work naturally.

---

## Metadata Mapping

The `metadata` field on `CheckoutParams` uses `customStr1` through `customStr5`. The webhook handler reads these from `webhook.raw`:

| Key | Usage |
|-----|-------|
| `customStr1` | Payment type: `'equipment_booking'` or `'subscription'` |
| `customStr2` | User ID |
| `customStr3` | Rental ID or Plan ID |
| `customStr4` | Billing interval (for subscriptions) |
| `customStr5` | Reserved |

PayFast maps these directly to `custom_str1`-`custom_str5` form fields. Paystack passes them inside its `metadata` JSON object and the adapter flattens them back into `raw` on webhook receipt, so the webhook handler code works identically for both providers.

---

## Where to Get Credentials

### PayFast

1. Go to [payfast.co.za](https://www.payfast.co.za)
2. Sign up for a merchant account (free, no monthly fees)
3. After registration, find your credentials at: **Settings > Integration**
   - **Merchant ID** - numeric ID
   - **Merchant Key** - alphanumeric key
   - **Passphrase** - set this yourself under Security settings
4. For sandbox/testing: use the [PayFast Sandbox](https://sandbox.payfast.co.za)
   - Sandbox Merchant ID: `10000100`
   - Sandbox Merchant Key: `46f0cd694581a`
   - Sandbox Passphrase: you set this in sandbox settings

```env
PAYFAST_MERCHANT_ID=10000100
PAYFAST_MERCHANT_KEY=46f0cd694581a
PAYFAST_PASSPHRASE=your_sandbox_passphrase
NEXT_PUBLIC_PAYFAST_SANDBOX=true
```

### Paystack

1. Go to [paystack.com](https://paystack.com)
2. Sign up for a business account
3. After registration, find your API keys at: **Settings > API Keys & Webhooks**
   - **Secret Key** - starts with `sk_test_` (test) or `sk_live_` (production)
   - **Public Key** - starts with `pk_test_` (test) or `pk_live_` (production)
4. Test mode keys are available immediately. Live keys require business verification.
5. Set your webhook URL in the Paystack dashboard: `https://yourdomain.com/api/webhooks/payfast`

```env
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### General

```env
# Required for resolving relative returnUrl/cancelUrl paths
NEXT_PUBLIC_APP_URL=https://yourdomain.com

# Which provider to use
PAYMENT_PROVIDER=payfast
```

---

## Files Modified by This Abstraction

| File | Change |
|------|--------|
| `lib/payments/types.ts` | Created - shared interface and types |
| `lib/payments/payfast.ts` | Created - PayFast adapter wrapping `lib/payfast.ts` |
| `lib/payments/paystack.ts` | Created - Paystack adapter with direct API integration |
| `lib/payments/index.ts` | Created - provider registry and env-based selection |
| `app/api/bookings/route.ts` | Updated - uses `payments.createCheckout()` |
| `app/api/subscriptions/route.ts` | Updated - uses `payments.createSubscriptionCheckout()` |
| `app/api/payfast/checkout/route.ts` | Updated - uses `payments.createSubscriptionCheckout()` |
| `app/api/webhooks/payfast/route.ts` | Updated - uses `payments.validateWebhook()` |
| `components/booking/BookingWidget.tsx` | Updated - added Paystack to allowed hosts |
| `app/(platform)/pricing/page.tsx` | Updated - added Paystack to allowed hosts |
| `.env.local` | Updated - added `PAYMENT_PROVIDER` variable |
