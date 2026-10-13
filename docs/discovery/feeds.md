# Product feeds and FAQ content: what we checked

Checked on 2026-10-13. Short answer: no shopping feed was built, because
renting gear is not something these programmes accept, and faking it would
risk the account. The FAQ answers that could be stated from real rules were
added; the rest wait for the owner.

## Google Merchant Center

Google's "Unsupported Shopping content" policy
(https://support.google.com/merchants/answer/6150006) says:

> Services: Labor, time, effort, expertise, or actions, which do not result
> in ownership of a tangible product are not allowed.

A hire gives use of the gear for some days and never ownership. Merchant
Center also has no attribute for a daily rental price: `price` is the price
to buy the item. Listing a camera at its day rate would claim you can buy a
R40 000 camera for R1 400, which is misrepresentation and a common reason for
account suspension. So rentals are not eligible as products and we did not
build `/feeds/google-merchant.xml`.

The free Ubunye apps are not eligible either: Merchant Center needs a real
price and a purchase, and they are free downloads.

What does help Google instead, and is already live: Product and Offer JSON-LD
on every gear page (PR #90), the sitemap, and a Google Business Profile for
the collection point (owner checklist in `README.md`).

If Google ever adds a rental listing type, the registry
(`lib/discovery/registry.ts`) already has everything a feed needs.

## ChatGPT merchant product feed (OpenAI)

OpenAI's merchant programme (product feed plus Instant Checkout through the
Agentic Commerce Protocol) is for physical goods a shopper buys. Each feed
item needs a buy price and availability, and checkout in ChatGPT has so far
been limited to selected markets and approved merchants (US first). A rental
priced per day with dates, an ID check and a deposit does not fit the item
model, and we could not find South African eligibility. Not built.

What ChatGPT and other assistants can already use: `/llms.txt`,
`/llms-full.txt`, the `/v1` catalogue API with OpenAPI, the `/mcp` server and
the markdown twins. OAI-SearchBot and ChatGPT-User are allowed in robots.txt.

Revisit when OpenAI lists South Africa and a service or rental item type.

## FAQ content

Added to the FAQ page, the llms files and the MCP `how_to_book` answer,
because each one is stated from rules in the code (`lib/content/faqs.ts`):

- "Can I rent camera gear in Johannesburg?": collection point, delivery
  radius, price and deposit shown before booking (from `STUDIO.location`,
  `STUDIO.fulfilment`).
- "What does verified mean on ThabangVision?": a person checks an ID photo and
  a selfie; a bookable creator is also open for work with a complete
  portfolio; a member listing gear needs the ID check and a validated bank
  account (from `isListedCreator` and the listing review rules).

The existing answers already cover deposits, delivery areas, notice, the ID
check, cancelling, VAT and bulk discounts.

### FAQ questions waiting for the owner

These are questions people ask assistants, but the code has no rule that
answers them, so nothing was published. Approve or edit, then add them in
`/admin/faqs` (they appear everywhere on their own):

1. "Is the gear insured while I rent it?" The code has a damage fee table
   switched off (`STUDIO.rental.protection.damageFees.published: false`) and
   Terms section 13. Needs the owner's wording.
2. "Can I rent gear in Pretoria or Sandton?" Delivery reaches them (100 km
   radius), but say whether a first hire from Pretoria must still be
   collected in Braamfontein (the rule says yes).
3. "What happens if I return gear late?" Late fees exist in
   `lib/rental/late-fee.ts`; the owner should confirm the public wording.
4. "Do you rent to students?" No rule either way.
5. "Can I hire a photographer for a wedding outside Gauteng?" Travel is
   "quoted separately"; the owner should say how.
