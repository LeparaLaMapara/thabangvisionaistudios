# WhatsApp phone checks: Meta setup

How to switch on phone checks by WhatsApp. The code is built and switched
off. It turns on by itself once the values in step 9 are set on Vercel.

## How it works

1. On the profile page the person taps **Verify on WhatsApp**.
2. The site saves a one-time code for them and the number they typed, and
   shows a button that opens WhatsApp with this message ready:
   `Verify my ThabangVision number: TV-482913`.
3. They send it. Meta passes it to
   `https://www.thabangvision.com/api/webhooks/whatsapp`.
4. The site checks Meta's signature. It confirms the number only when the
   number that SENT the message is the number they typed. WhatsApp vouches
   for the sender, so that proves the person holds the number.
5. The site replies "Your number is confirmed" and the profile page updates
   by itself.

Only the number is stored, on the profile, once confirmed. Message text and
full numbers are never logged.

## Free or paid

From Meta's pricing page (checked 2026-10-14):

- Messages people send to us are not charged.
- Every message that is not a template (plain text included) is free.
  Plain text can only be sent inside the 24-hour customer service window,
  which opens when the person messages us.

That covers this whole flow: they message first, and we reply inside the
window. Templates (messages we start ourselves) are charged per message.
This flow never uses them.

## Before you start: which number

The number you register with the Cloud API is the one people message. Meta
does not let a number run on the Cloud API and in the normal WhatsApp or
WhatsApp Business app at the same time, unless you use Meta's "coexistence"
onboarding. **Check in Meta's dashboard** whether coexistence is offered for
your number before you move the number customers already use
(063 990 5802). The simplest safe choice is a second SIM just for the API.

## Steps

### 1. Create the Meta app

1. Go to [developers.facebook.com](https://developers.facebook.com) and log in
   with the Facebook account that manages the ThabangVision business portfolio.
2. **My Apps > Create App**.
3. Pick the use case **Connect with customers through WhatsApp**. Older
   versions of the dashboard ask for an app type: choose **Business**.
4. Pick the ThabangVision business portfolio and create the app.
5. This adds the WhatsApp product. If it does not, add **WhatsApp** from
   **Add products** on the app dashboard.

### 2. Add and verify the business phone number

1. Open **WhatsApp > API Setup**. Meta first gives you a test number. Ignore it.
2. **Add phone number**. Enter the business display name, category and
   description, then the number.
3. Verify the number with the code Meta sends by SMS or voice call.
4. Copy the **Phone number ID** shown under the number. It is an ID, not the
   phone number. This is `WHATSAPP_PHONE_NUMBER_ID`.
5. Set a payment method on the WhatsApp account if Meta asks for one. **Check
   in Meta's dashboard**: Meta may ask even though this flow sends nothing
   that is charged.

### 3. Business verification (CIPC documents)

1. Go to [business.facebook.com](https://business.facebook.com) >
   **Business Settings > Security Centre > Start verification**. The menu
   names move around, so **check in Meta's dashboard**.
2. Use the legal name exactly as CIPC registered it: THABANGVISION STUDIO
   (PTY) LTD, the registration number, address, and a phone number or email
   on the company domain.
3. Upload the CIPC registration certificate (CoR 14.3). Have a utility bill or
   bank letter in the company name ready too.
4. Wait for approval. It usually takes a few working days.

Until the business is verified, Meta limits how many people you can message
first. Replies to people who message you are covered by the service window.
**Check in Meta's dashboard** for the current limits on an unverified account.

### 4. Display name approval

1. **WhatsApp Manager > Phone numbers** shows the display name status.
2. The name must match the business (for example "ThabangVision"). Meta
   reviews it, usually within a few days. If it is rejected, change it to
   match the website and the CIPC name more closely, then resubmit.
3. **Check in Meta's dashboard** whether the number can receive messages while
   the name is pending. Do the live test (step 10) after it is approved.

### 5. Permanent access token (System User)

The token in API Setup expires within a day. Make a permanent one:

1. **Business Settings > Users > System users > Add**. Name it, say
   `thabangvision-whatsapp`, with the **Admin** role.
2. **Assign assets**: the app with **Manage app** (full control), and the
   WhatsApp account with **Manage WhatsApp Business accounts** (full control).
3. **Generate new token** for the app. Set expiry to **Never** and tick
   `whatsapp_business_messaging` and `whatsapp_business_management`. Meta's
   guide also ticks `business_management`.
4. Copy the token. Meta shows it once. This is `WHATSAPP_ACCESS_TOKEN`.

### 6. App secret

**App settings > Basic > App secret > Show**. This is
`WHATSAPP_APP_SECRET`. Meta signs every webhook with it, and the site
refuses anything unsigned or wrongly signed.

### 7. Verify token

Make up a long random string, for example from `openssl rand -hex 24` or a
password manager. This is `WHATSAPP_VERIFY_TOKEN`. It is ours, not Meta's.

### 8. Webhook

Do this after step 9 is deployed. Meta calls the site to check the token the
moment you save, so the values must already be live.

1. App dashboard **WhatsApp > Configuration > Webhook > Edit**.
2. Callback URL: `https://www.thabangvision.com/api/webhooks/whatsapp`
   (with `www`: the bare domain redirects, and webhooks should not depend on
   redirects).
3. Verify token: the string from step 7.
4. **Verify and save**. It fails if the token on Vercel is different or not
   deployed yet.
5. Under **Webhook fields**, **Subscribe** to `messages`. Nothing else is needed.
6. **Check in Meta's dashboard** that the WhatsApp account itself is
   subscribed to the app. With a real number this sometimes needs a one-off
   `POST /<WABA_ID>/subscribed_apps` call with the token. Claude can make that
   call if messages do not arrive.
7. Switch the app to **Live** mode (top of the app dashboard). In development
   mode Meta only delivers webhooks for test numbers.

### 9. Put the values in `.env.local`

Add these to `.env.local` in the repo (it is git-ignored), then ask Claude to
copy them to Vercel. Claude does not print them.

```
PHONE_VERIFY_CHANNEL=whatsapp
WHATSAPP_VERIFY_TOKEN=<step 7>
WHATSAPP_APP_SECRET=<step 6>
WHATSAPP_ACCESS_TOKEN=<step 5>
WHATSAPP_PHONE_NUMBER_ID=<step 2.4>
WHATSAPP_BUSINESS_NUMBER=+27XXXXXXXXX   # the number from step 2, E.164
```

Optional:

- `PHONE_CODE_SECRET`: 32+ random characters (`openssl rand -base64 32`).
  Without it the codes are hashed with the Supabase service role key.
- `WHATSAPP_GRAPH_VERSION`: only if Meta retires the default version in
  `lib/whatsapp/meta.ts`.

What turns on when:

- The **Verify on WhatsApp** button appears once `WHATSAPP_VERIFY_TOKEN`,
  `WHATSAPP_APP_SECRET` and `WHATSAPP_BUSINESS_NUMBER` are set. The phone
  step then becomes required for renters (`lib/sms/availability.ts`).
- The "confirmed" reply also needs `WHATSAPP_ACCESS_TOKEN` and
  `WHATSAPP_PHONE_NUMBER_ID`. Without them confirming still works, with no
  reply.
- `PHONE_VERIFY_CHANNEL=whatsapp` turns phone checks OFF (hidden) if any
  WhatsApp value is missing. It never falls back to SMS. `sms` picks the SMS
  check instead.

### 10. Live test

1. On the profile page, enter your own mobile number and tap
   **Verify on WhatsApp**.
2. Send the prefilled message without changing it.
3. Within a few seconds the page should show **Number confirmed**, and
   WhatsApp should get the confirmation reply.
4. Try it from a different phone than the number you typed. It must NOT
   confirm, and you get the "could not match" reply.

If nothing happens, check the Vercel logs for `[whatsapp/verify]`. A 401
there means the app secret on Vercel is wrong.
