# DESIGN.md — Full Visual & UX Audit

**Audit Date:** 2026-03-09
**Auditor:** Claude Code
**Context:** This is a creative industry platform for South African filmmakers and photographers. It must feel premium, cinematic, and effortless. Anything that looks like a generic SaaS template is a failure.

---

## Global Design System Assessment

**Design Language:** Technical-cinematic. Monospace labels (`font-mono text-[10px] uppercase tracking-widest`), numbered sections (`01 // Title`), industrial borders, near-black backgrounds (`#050505`, `#080808`, `#0A0A0B`). This is a strong identity when it's consistent — the problem is it's not always consistent.

**Typography:** Uses `font-display` for headlines (large, uppercase, tight tracking) and `font-mono` for everything else. No serif anywhere. The hierarchy works but becomes monotonous across 30+ pages — every page feels the same weight.

**Color:** Almost entirely monochrome. The only color comes from status badges (emerald, amber, red) and the occasional `text-accent`. For a platform serving *visual artists*, this is too restrained. There's no brand color. No warmth. No South African identity.

**Animation:** Framer-motion is used well — staggered entrances, scroll-triggered reveals, hover zoom+desaturation on images. This is one of the strongest aspects of the design.

**Critical Systemic Issues:**
1. Raw `<img>` tags used on most pages instead of `next/image` — no lazy loading, no optimization, no blur placeholders. Unacceptable for a media-heavy platform.
2. No skeleton loading states anywhere — just spinners. Feels dated.
3. Empty states are plain text. A creative platform should make even "nothing here" feel designed.
4. No brand color or visual identity beyond monochrome. This could be any tech startup.
5. Social links in footer all point to `#` — looks broken, not "coming soon."

---

## Page-by-Page Audit

---

### 1. HOME PAGE — `/`

**First Impression:** Premium. The parallax hero with grid overlay, the "We Engineer The Invisible" headline, the system status readout in the corner — this feels like a high-end creative agency. It sets expectations that the rest of the site struggles to meet.

**Navigation:** Clear. Six numbered sections flow naturally: Hero → Case Studies → Services → Tech Arsenal → Community → Booking CTA → Contact CTA. The horizontal scroll gallery is intuitive.

**Visual Richness:** HIGH. Parallax background, grid texture overlay, grayscale-to-color hover on tech cards, horizontal scroll gallery with snap points, stat cards in the booking section. This is the design benchmark for the rest of the site.

**Usability:** Good. CTAs are clear ("Explore The Lab", "Browse Equipment", "Initiate Project"). The Community section effectively drives to registration, verification, and rentals.

**Mobile:** Intentional. The hero text scales well (`text-5xl md:text-8xl`). System status readout hides on mobile (`hidden md:block`). Gallery snaps horizontally. The stat grid stacks.

**Content Density:** Well-balanced. Each section has breathing room with `py-32` padding. Never feels cluttered.

**Score:** Visual 8/10, Usability 8/10

**What Needs to Change:**
- Hero background image is from Unsplash (generic neon arcade). Should be original production footage or a South African creative scene.
- "LAT: 34.0522 N / LONG: 118.2437 W" — this is Los Angeles coordinates. The studio is in Johannesburg. Either use JHB coordinates or remove it.
- Projects gallery reads from `lib/data.ts` mock data, not Supabase. Hardcoded content on the most important page.
- The "06 // Contact" CTA section at the bottom is massive white space with just a heading and button. Could use a background image or gradient.

---

### 2. LOGIN — `/login`

**First Impression:** Clean and focused. Minimal form, brand-consistent typography. Feels secure and intentional.

**Navigation:** Simple. Login → Register link at the bottom. Auto-redirects if session exists (good UX).

**Visual Richness:** LOW but appropriate for a login page. The subtle border card, the thin line divider below the heading, the loading spinner in the button — all polished.

**Usability:** Excellent. Two fields, clear labels, visible error states with animation. Loading state in the submit button. Session check on mount.

**Mobile:** Works. Max-width card (`max-w-sm`) centers naturally. Full padding.

**Content Density:** Perfect for purpose.

**Score:** Visual 6/10, Usability 9/10

**What Needs to Change:**
- Says "Admin Login" — but this is also for regular users now (since registration exists). Should say "Sign In" or "Welcome Back."
- No "Forgot Password" link. Critical omission.
- No social login options. For a creative community, Google/Instagram OAuth would reduce friction massively.

---

### 3. REGISTER — `/register`

**First Impression:** Matches login exactly. Consistent, professional.

**Navigation:** Register → Login link. Auto-redirect if logged in.

**Visual Richness:** Same as login. Appropriate.

**Usability:** Good. Four fields. Password match validation. Minimum length check. Creates profile row on success. But no password strength indicator.

**Mobile:** Same as login — works well.

**Content Density:** Fine.

**Score:** Visual 6/10, Usability 8/10

**What Needs to Change:**
- No terms/privacy checkbox. For a platform handling identity documents and payments, this is a legal gap.
- No email confirmation flow mentioned — Supabase signUp may require it but the UX doesn't account for it.
- Display name is optional but should be encouraged — the placeholder "Your name" doesn't convey that this is the public-facing name.

---

### 4. CONTACT — `/contact`

**First Impression:** One of the best-designed pages. The "Initiate Contact" heading with tech-themed labels ("Identity", "Frequency", "Transmission Data", "Subject Protocol") creates an immersive brand experience.

**Navigation:** Clear two-column layout. Form left, contact info right.

**Visual Richness:** MEDIUM-HIGH. Underline-only inputs (no box borders), honeypot spam protection, the "Transmission Received" success state with the circular icon — all thoughtful.

**Usability:** Excellent. Subject dropdown, proper validation, loading state, error dismissal. Honeypot field hidden with aria-hidden. Wired to `/api/contact` (Resend integration).

**Mobile:** Stacks gracefully. Full-width form, info column below.

**Content Density:** Good balance. The "Global Desks" section feels aspirational but adds credibility.

**Score:** Visual 8/10, Usability 9/10

**What Needs to Change:**
- The honeypot field uses `position: absolute` which could cause layout issues. Better to use `display: none` or `height: 0; overflow: hidden` on the wrapper.
- "Global Desks" lists Cape Town and Los Angeles — make sure these are real partnerships or label them as "Planned."
- Phone number (+27 10 555 0123) looks fake (555 is a placeholder). Use a real number or remove.

---

### 5. CAREERS — `/careers`

**First Impression:** Professional. Server-rendered from Supabase. The culture/benefits section adds personality. Job listings are well-structured with department, location, employment type metadata.

**Navigation:** Clear. Culture → Open Positions → General Application fallback.

**Visual Richness:** MEDIUM. Clean cards with hover underline on titles. Benefits grid has good typographic weight. But no imagery anywhere — this is a page about joining a visual studio and there's not a single photo.

**Usability:** Good. "Apply Now" buttons are prominent. Requirements rendered as a bulleted list. Empty state handled ("No open roles at this time").

**Mobile:** Stacks well. Cards go full-width. Metadata wraps naturally.

**Content Density:** Right for the content type.

**Score:** Visual 6/10, Usability 7/10

**What Needs to Change:**
- "Apply Now" buttons don't link anywhere — they're `<span>` tags, not `<a>` or `<Link>`. Clicking does nothing. This is broken.
- No application form or email link per role. The only way to apply is the generic email at the bottom.
- Add team photos, studio photos, or a video. This is a creative studio — show the workspace.
- Missing `employment_type` formatting — shows raw values like "full-time" instead of "Full-Time."

---

### 6. PRESS — `/press`

**First Impression:** Clean editorial layout. The magazine-style article cards with cover images, dates, and "Read Article" links look professional.

**Navigation:** Simple. Articles list → Media Inquiries section.

**Visual Richness:** MEDIUM. Grayscale-to-color image hover effect (cinematic, consistent with the brand). Large typography for article titles. But the layout is a single column of cards — no featured article, no grid variation.

**Usability:** Decent. But "Read Article" links don't go anywhere — there's no article detail page. The content field is rendered as a paragraph, not as rich text. No truncation.

**Mobile:** Stacks. Image takes full width above text on mobile.

**Content Density:** Could be too sparse if there are few articles. No pagination.

**Score:** Visual 6/10, Usability 5/10

**What Needs to Change:**
- No article detail page exists. "Read Article" is a dead end — the entire article content is dumped inline. Need `/press/[slug]` pages.
- First/featured article should be visually differentiated (larger, different layout).
- Article dates show raw `published_at` string — not formatted. Could show "2 days ago" or "March 7, 2026."
- No category filtering or search.
- The `cursor-pointer` on article cards implies clickability but there's nothing to click through to.

---

### 7. THE LAB — `/lab`

**First Impression:** Strong. The R&D division page sells technical credibility. Six capability cards in a 1px-gap grid with icons, descriptions, and an expanding line on hover. The CTA section at the bottom is bold.

**Navigation:** Clear. Overview → Capabilities grid → CTA.

**Visual Richness:** HIGH. The grid layout with 1px borders (`gap-px bg-neutral-200`), fixed card heights (`h-80`), and the hover line animation (`w-8 → w-full transition-all duration-500`) are distinctive. This feels engineered.

**Usability:** Good as a marketing page. Clear CTA to contact. Each capability is well-described.

**Mobile:** Stacks to single column. Cards maintain height.

**Content Density:** Right amount. Each card is concise.

**Score:** Visual 8/10, Usability 7/10

**What Needs to Change:**
- The icon sizes (`w-8 h-8`) feel too large for the card proportion. Try `w-6 h-6`.
- No links from individual capabilities to deeper content. Could link to relevant case studies or tools.
- The CTA section uses a large `font-bold` heading style that doesn't match the `font-medium` used elsewhere. Inconsistent.

---

### 8. LOCATIONS — `/locations`

**First Impression:** Clean but thin. Two location cards with Unsplash images, address, phone, hours. An "International Support" section lists partner cities.

**Navigation:** Minimal. Just locations → international.

**Visual Richness:** MEDIUM. Grayscale-to-color image hover, overlay darkening, type badge on images. But only two cards — the page feels empty.

**Usability:** Fine for what it is. Phone numbers are not linked (`<p>` tags, not `<a href="tel:">`).

**Mobile:** Stacks to single column.

**Content Density:** TOO SPARSE. Two cards and a list of cities. This could be a section on the About page, not a full page.

**Score:** Visual 5/10, Usability 5/10

**What Needs to Change:**
- Phone numbers should be clickable (`<a href="tel:...">`).
- Images are from Unsplash, not actual studio locations. Replace with real photos.
- The "International Support" cities (Los Angeles, New York, London, Berlin, Dubai, Tokyo) feel aspirational. If these aren't real partnerships, this damages trust.
- Add a map embed or at least a static map image.
- Consider merging this into the Contact page or a combined About/Locations page.

---

### 9. LEGAL — `/legal`

**First Impression:** Functional. Standard Terms of Service page with prose styling.

**Navigation:** None needed. Single document.

**Visual Richness:** MINIMAL. Prose-styled text content. No visual treatment.

**Usability:** Fine. Readable. Proper heading hierarchy.

**Mobile:** Works. Prose container is responsive.

**Content Density:** Appropriate.

**Score:** Visual 3/10, Usability 7/10

**What Needs to Change:**
- "Last Updated: October 2024" — update this date.
- No table of contents for quick navigation.
- Consider adding a sidebar TOC on desktop that sticks as you scroll.

---

### 10. PRIVACY — `/privacy`

**First Impression:** Matches Legal. Same template.

**Navigation:** Same as Legal.

**Visual Richness:** Same. Minimal.

**Usability:** Fine.

**Mobile:** Fine.

**Score:** Visual 3/10, Usability 7/10

**What Needs to Change:**
- Same issues as Legal.
- Privacy policy mentions newsletters but there's no newsletter signup visible on the platform.
- "privacy@thabangvision.com" — ensure this email exists.

---

### 11. TECHNICAL SUPPORT — `/support/tech`

**First Impression:** Feels like a premium tech support portal. The "Live Support Online" pulsing badge, the quick diagnostics cards, the ticket form with urgency levels — this is well-designed for the audience.

**Navigation:** Quick Diagnostics sidebar → Ticket Form main area.

**Visual Richness:** MEDIUM-HIGH. Pulsing green dot, motion hover on diagnostic cards (`whileHover={{ x: 5 }}`), sectioned layout.

**Usability:** The ticket form works but submits to nowhere — it just shows a hardcoded "Ticket #8829 Created" response. No actual backend.

**Mobile:** Good. Sidebar stacks above form on mobile.

**Content Density:** Right amount.

**Score:** Visual 7/10, Usability 4/10

**What Needs to Change:**
- Ticket form is 100% fake. No API endpoint, no email notification. Either wire it up or remove the form and replace with a "Contact Support" email link.
- Quick Diagnostics cards ("Firmware Status", "Lens Charts", "Emergency Procedures") are not clickable. They imply interaction but deliver nothing.
- "Live Support Online" badge is misleading — there is no live chat. Remove or change to "Support Available."
- The hardcoded ticket number #8829 is silly. If keeping the form, generate a random number at least.

---

### 12. SMART PRODUCTIONS — `/smart-production`

**First Impression:** Depends entirely on data. Server-rendered from Supabase. The client component has a filter bar and a responsive grid of project cards with category grouping.

**Navigation:** Filter bar at top → scrollable project grid.

**Visual Richness:** MEDIUM. Staggered entrance animations, hover border transitions, category numbering. But the cards are simple bordered boxes with text — no image thumbnails in the grid view.

**Usability:** Good filtering. Categories shown as pills. Empty state handled.

**Mobile:** Responsive grid (`grid-cols-1 lg:grid-cols-2`). Filters work on mobile.

**Content Density:** Depends on data volume.

**Score:** Visual 5/10, Usability 7/10

**What Needs to Change:**
- No thumbnail images in the production grid. For a visual production company, this is a major miss. Every production card should show its cover image.
- The filter bar is text-only with monospace buttons — could use category icons or color coding.
- No search functionality. If there are 50+ productions, scrolling through categories isn't enough.

---

### 13. PRODUCTION DETAIL — `/smart-production/[slug]`

**First Impression:** Good. Two layout variants: "Film" (video hero + details) and "Photography" (gallery layout). Shows design flexibility.

**Navigation:** Back link to productions list. Tabs for Overview/Gallery.

**Visual Richness:** MEDIUM-HIGH for Film variant. Video hero with gradient overlay, shadow-2xl. Photography variant is more minimal.

**Usability:** Good. Video embeds work. Gallery with thumbnails. Tags displayed.

**Mobile:** Responsive grid. Video aspect ratio maintained.

**Content Density:** Appropriate.

**Score:** Visual 7/10, Usability 7/10

**What Needs to Change:**
- Photography layout is underdeveloped compared to Film layout. Gallery needs a lightbox for full-screen image viewing.
- No share buttons or social meta tags for portfolio pieces.
- No "Related Projects" section at the bottom.
- Uses raw `<img>` tags — switch to `next/image` for the gallery.

---

### 14. SMART RENTALS — `/smart-rentals`

**First Impression:** One of the best pages. The hero with large "SMART RENTALS" text, category grid with cinematic image treatment (grayscale → color, scale zoom, gradient overlay, numbered entries) — this feels premium.

**Navigation:** Category grid → individual category pages.

**Visual Richness:** HIGH. The image hover effects (zoom + desaturation removal + overlay fade + description reveal) are the best in the codebase. The 1px gap grid creates an editorial look.

**Usability:** Clear. Category cards are obvious click targets. Each shows a description on hover.

**Mobile:** Grid stacks. Images maintain aspect ratios.

**Content Density:** Good. Not too many categories to overwhelm.

**Score:** Visual 8/10, Usability 8/10

**What Needs to Change:**
- Category images are hardcoded Unsplash URLs in a `CATEGORY_IMAGES` map, not from the database. Should pull from actual rental thumbnails.
- The "Coming Soon" subtitle is still showing even though rentals are live.
- Community listings are merged with studio rentals but there's no visual distinction between "Official" and "Community" items. Should badge or section them differently.

---

### 15. RENTAL CATEGORY — `/smart-rentals/[category]`

**First Impression:** Most functionally complete page. Sidebar filter panel (brand, price range, availability, condition), grid of rental cards with detailed metadata, status badges.

**Navigation:** Breadcrumb → filters → results. Complex but well-organized.

**Visual Richness:** HIGH. Availability pulse dots, backdrop blur badges, grayscale-to-color image hover, accordion filters with icon rotation, animated filter panel for mobile.

**Usability:** Excellent. Filters update results in real-time. Mobile filter modal. Price display is clear. Availability status is prominent.

**Mobile:** Full mobile filter modal (`AnimatePresence`). Desktop sidebar hidden on mobile. This is intentional mobile design, not just responsive defaults.

**Content Density:** Right. Dense filter sidebar balanced by spacious results grid.

**Score:** Visual 8/10, Usability 9/10

**What Needs to Change:**
- The filter sidebar scrolls independently but doesn't have a sticky position. On tall result lists, you lose the filters.
- No "Sort By" option (price low→high, newest, etc.).
- Price range filter appears to be a text input, not a slider. A range slider would be more intuitive.
- Search within category would be useful.

---

### 16. RENTAL DETAIL — `/smart-rentals/[category]/[slug]`

**First Impression:** Well-structured product page. Hero image with gallery thumbnails, tabbed content (Overview/Features/Includes), pricing sidebar, availability status.

**Navigation:** Breadcrumb trail → media → tabs → pricing sidebar. Sticky sidebar on desktop.

**Visual Richness:** MEDIUM. Clean layout but lacks the cinematic treatment of the rental listing pages. The hero image area is a simple bordered box. No gradient overlay, no zoom effect.

**Usability:** Good. Tab interface works. Gallery thumbnails switch main image. Pricing is clear with daily/weekly rates and deposit.

**Mobile:** Stacks. Sidebar moves below content.

**Content Density:** Good balance of media and information.

**Score:** Visual 6/10, Usability 8/10

**What Needs to Change:**
- Hero image area needs more visual treatment — gradient overlay, hover zoom, lightbox on click.
- No booking widget embedded directly on this page. Users see pricing but have to navigate elsewhere to book. The BookingWidget component exists but isn't used here.
- Gallery thumbnails are tiny (`w-20 h-20`). Increase size or add a lightbox.
- No "Related Equipment" or "Frequently Rented Together" section.
- Video embed support exists but isn't visually prominent.

---

### 17. CATALOG DETAIL — `/catalog/[slug]`

**First Impression:** The most visually polished detail page. Uses `next/image` (unique in the codebase!), has a full-viewport hero with gradient overlay and zoom-in entrance animation, staggered text reveals. This is what the rental detail page should look like.

**Navigation:** Breadcrumb → hero → specs → features → gallery. Sticky sidebar.

**Visual Richness:** HIGHEST in the codebase. Gradient overlays (`from-white via-transparent`), hero zoom animation (`scale: 1.1 → 1`, `duration: 1.5`), staggered text entrance, branded Badge and Card components.

**Usability:** Good. Availability badge, price display, feature checklist, gallery grid.

**Mobile:** Responsive. Hero scales. Sidebar stacks below.

**Content Density:** Well-balanced.

**Score:** Visual 9/10, Usability 8/10

**What Needs to Change:**
- This page duplicates the rental detail page but with better design. These should be unified — apply this design to the rental detail page.
- No booking widget here either.
- Gallery images don't open in a lightbox.

---

### 18. UBUNYE AI STUDIO — `/ubunye-ai-studio`

**First Impression:** Strong marketing page. The capability grid with full-bleed images and gradient overlays, numbered sections with anchor navigation, the Lab CTA with pulsing CPU icon — this sells the vision.

**Navigation:** Hero → Capability grid (clickable, scrolls to anchor) → Detailed sections → CTA.

**Visual Richness:** HIGH. Full-bleed image cards with gradient from-black overlays, scale zoom on hover, border glow effect, numbered typography. The anchor scroll behavior is a nice touch.

**Usability:** Good for a marketing page. Each capability links to its detailed section. "Consult Engineer" CTAs are contextual.

**Mobile:** Grid stacks. Images maintain aspect ratios.

**Content Density:** Good. Dense but organized.

**Score:** Visual 8/10, Usability 7/10

**What Needs to Change:**
- This is entirely static. No AI features are functional. Should clearly communicate "Coming Soon" or "In Development" to set expectations.
- The `animate-pulse-slow` class on the Cpu icon may not be defined in the Tailwind config.
- Feature items in detailed sections use a generic `Box` icon — should use more descriptive icons per feature.
- No demo, no waitlist signup, no video showcase. For an AI product page, this needs interactive proof.

---

### 19. PRICING — `/pricing`

**First Impression:** Clean SaaS pricing page. Three-tier cards (Starter/Pro/Studio), monthly/annual toggle, "Most Popular" badge on Pro. Uses the shared UI components (Card, Badge, Button).

**Navigation:** Toggle → Cards → FAQ note at bottom.

**Visual Richness:** MEDIUM. The toggle buttons are nicely styled. Pro card has a highlighted border. But the cards themselves are plain white boxes — no gradient, no depth, no illustration.

**Usability:** Good. Clear pricing. Feature checklists. CTAs differentiated (Get Started / Upgrade to Pro / Contact Sales).

**Mobile:** Cards stack to single column. Toggle remains centered.

**Content Density:** Appropriate.

**Score:** Visual 6/10, Usability 8/10

**What Needs to Change:**
- The Pro card needs more visual emphasis — currently just a border. Add a subtle gradient background or shadow.
- "Save 17%" badge overflows the annual button on small screens.
- No FAQ section. Pricing pages need FAQs to reduce friction.
- Prices are in ZAR but there's no explanation for international users.
- The "Upgrade to Pro" button for Pro plan doesn't link to anything — it needs a Stripe/PayFast checkout flow.

---

### 20. DASHBOARD — `/dashboard`

**First Impression:** Bare. Three stat cards all showing "0", and a gray box saying "Your activity and recent transactions will appear here." For a user who just registered, this is deflating.

**Navigation:** Relies on the dashboard sidebar layout.

**Visual Richness:** VERY LOW. Three identical gray boxes and a larger gray box. No color, no icons, no personality.

**Usability:** Shows nothing useful until the user has data. No onboarding guidance.

**Mobile:** Stacks fine but there's nothing to see.

**Content Density:** Too empty.

**Score:** Visual 2/10, Usability 3/10

**What Needs to Change:**
- This is the weakest page on the platform. A new user lands here after registration and sees three zeros. Where's the welcome flow?
- Add an onboarding checklist: "Complete your profile", "Browse equipment", "Get verified to list gear."
- Add quick action cards: "Book Equipment", "List Your Gear", "Edit Profile."
- The stat cards should show actual counts from the database, not hardcoded "0".
- Add a "Recent Activity" feed that shows platform-wide activity if the user has none.
- Consider a hero section: "Welcome to ThabangVision, [Name]. Here's what you can do."

---

### 21. DASHBOARD PROFILE EDIT — `/dashboard/profile`

**First Impression:** Functional form page. Avatar upload, basic info, skills tags, social links. Uses the shared UI components (Input, Textarea, Button).

**Navigation:** Part of dashboard layout. Clear form sections.

**Visual Richness:** LOW. It's a form. The avatar circle with Camera icon fallback is nice. Skill tags with X-to-remove work well.

**Usability:** Good. Cloudinary avatar upload with signed URLs. Skills add/remove with keyboard support. Social links for 5 platforms. Success/error messages animated.

**Mobile:** Works. Grid collapses. Avatar section stacks.

**Content Density:** Appropriate for a form.

**Score:** Visual 5/10, Usability 8/10

**What Needs to Change:**
- No image cropping for avatar (unlike admin pages which have react-easy-crop). Avatars will look inconsistent.
- No character counter visible on the bio field (maxLength is set but not displayed).
- Social link fields should show the platform icon next to the label, not just text.
- No "View Public Profile" link to preview what others see.

---

### 22. DASHBOARD BOOKINGS — `/dashboard/bookings`

**First Impression:** Well-structured list page. Tab navigation (Upcoming/Past/Cancelled), booking cards with status badges, date ranges, and pricing.

**Navigation:** Tabs → Card list → Card links to detail page.

**Visual Richness:** MEDIUM. Uses shared Card and Badge components. Status colors are meaningful. Tab interface is clean.

**Usability:** Good. Tabs filter appropriately. Empty state has a CTA to browse rentals. Each card links to detail.

**Mobile:** Cards stack. Tabs scroll horizontally if needed.

**Content Density:** Appropriate.

**Score:** Visual 6/10, Usability 8/10

**What Needs to Change:**
- Booking cards show a truncated ID (`#abc12345`) but no equipment name or image. Users don't remember booking IDs — show the item name and thumbnail.
- No calendar view option. For a rental platform, a calendar showing upcoming pickups/returns would be more useful than a list.

---

### 23. BOOKING DETAIL — `/dashboard/bookings/[id]`

**First Impression:** Comprehensive. Two info cards (Rental Period, Payment Summary), notes section, payment history, invoices. Status badge prominent.

**Navigation:** Back link → Header → Cards → Payment/Invoice sections.

**Visual Richness:** MEDIUM. Uses Card and Badge components consistently. Payment summary layout is clear. But the whole page is boxes of text — no images, no visual anchors.

**Usability:** Good. Cancel button for pending/confirmed bookings with confirmation dialog. Date formatting is locale-aware (en-ZA).

**Mobile:** Two-column cards stack to single. Everything works.

**Content Density:** Right amount.

**Score:** Visual 5/10, Usability 8/10

**What Needs to Change:**
- No equipment image or link to the rental item. Users can't visually confirm what they booked.
- Payment History and Invoices sections are always empty (hardcoded `[]`). These need to be wired to the database.
- The cancel button uses `confirm()` — a native browser dialog. Use a styled confirmation modal instead.

---

### 24. DASHBOARD VERIFICATION — `/dashboard/verification`

**First Impression:** Clear purpose-driven page. Four states (Unverified, Pending, Verified, Rejected) each with appropriate messaging and icons. File upload with drag-and-drop.

**Navigation:** Single-purpose page. State determines what's shown.

**Visual Richness:** MEDIUM. State-specific icons (CheckCircle, Clock, XCircle) with colored accents. Dashed border file dropzones. Green confirmation state on uploaded files.

**Usability:** Good. Drag-and-drop or click to upload. File type validation. Three required documents clearly labeled. Rejection shows reason and allows resubmission.

**Mobile:** Works. Upload zones are full-width. Touch-friendly.

**Content Density:** Appropriate. Progressive disclosure based on status.

**Score:** Visual 6/10, Usability 8/10

**What Needs to Change:**
- File size limit isn't communicated (the UI should say "Max 5MB" or whatever the limit is).
- No progress indicator during upload. Users don't know if a large file is uploading.
- The "SA ID Document" labeling is South Africa-specific (good!) but doesn't explain what formats are accepted clearly.
- No estimated review timeline shown (the text says "1-2 business days" but only after submission).

---

### 25. DASHBOARD LISTINGS — `/dashboard/listings`

**First Impression:** Functional CRUD page. Verification gate (must be verified to list), inline create/edit form, listing cards with edit/delete actions.

**Navigation:** Verification gate → Create button → Form → List.

**Visual Richness:** LOW. It's a form and a list. No imagery. Cards are text-only with price and category metadata.

**Usability:** Good. Inline form saves navigation. Slug auto-generated from title. Category and condition dropdowns. Soft delete pattern.

**Mobile:** Works. Form grid collapses.

**Content Density:** Appropriate.

**Score:** Visual 4/10, Usability 7/10

**What Needs to Change:**
- No image upload for listings. This is a gear listing platform — photos are essential. Without images, listings are just text entries that nobody will trust.
- No image gallery support at all in the form.
- The verification gate is good UX but the empty state could show example listings to inspire.
- No way to toggle publish/unpublish from the list view.
- Listing cards don't link to a public view. Users can't preview their listing.

---

### 26. CREATOR PROFILE — `/creators/[id]`

**First Impression:** Clean but minimal. Avatar with verification badge, bio, skills tags, social links. Feels more like a profile card than a portfolio page.

**Navigation:** Single page. No sub-sections.

**Visual Richness:** LOW. Circle avatar, text sections, tag badges. No background, no hero, no visual identity for the creator.

**Usability:** Shows essential info. Skills are scannable. Social links open in new tabs.

**Mobile:** Works. Flex layout adjusts.

**Content Density:** TOO SPARSE. For a "creator profile" on a creative platform, this is embarrassingly thin.

**Score:** Visual 4/10, Usability 6/10

**What Needs to Change:**
- No portfolio/work section. A creator profile without showing their work is useless. Add a gallery grid or link to their productions.
- No equipment listings shown. If the creator is renting gear, show their active listings.
- No contact/message button. How do users reach this creator?
- The avatar fallback (first letter of name) looks generic. Add a default avatar illustration.
- No cover/banner image. The profile feels like a form output, not a showcase.
- No reviews or ratings section.

---

### 27. ADMIN DASHBOARD — `/admin`

**First Impression:** This is excellent. The KPI cards with color-coded metrics, Quick Create buttons, activity feed with type badges and relative timestamps, draft management with thumbnails, featured content grid — this is a well-designed admin panel.

**Navigation:** KPI → Quick Create → Activity Feed + Drafts (side-by-side) → Featured Content → Studio Overview.

**Visual Richness:** HIGH for an admin page. Color-coded type badges (blue=Production, violet=Rental, green=Press), accent borders on KPI cards, thumbnail previews in drafts, opacity transitions on featured images.

**Usability:** Excellent. Everything links to the relevant admin section. Activity feed shows recency. Drafts panel highlights unpublished content. Featured grid gives visual overview.

**Mobile:** Grid collapses appropriately. Activity feed works in single column.

**Content Density:** Dense but organized. Each section serves a distinct purpose.

**Score:** Visual 8/10, Usability 9/10

**What Needs to Change:**
- The header hardcodes "text-white" even in light mode. Admin pages assume dark mode.
- No bookings count or revenue metrics in the KPI row. Add a Bookings card and a Revenue card.
- Quick Create buttons link to the list page, not directly to a create form. Could pre-open the form.
- No system health indicators (Supabase status, Cloudinary usage, etc.).

---

### 28. ADMIN PROJECTS — `/admin/projects`

**First Impression:** Feature-rich CRUD page. Image upload with cropping, gallery management, video URL support, tag entry, publish/feature toggles, drag-and-drop. This is the gold standard for the admin panels.

**Navigation:** List → Create/Edit form (inline) → Image management.

**Visual Richness:** MEDIUM for an admin page. Crop modal is full-screen dark overlay. Gallery grid shows thumbnails. List items have publish/feature indicators.

**Usability:** Excellent. react-easy-crop for image processing. Cloudinary signed uploads with progress. Auto-slug from title. Gallery add/remove. Full metadata form.

**Mobile:** Usable but the crop modal and gallery management would be difficult on small screens.

**Content Density:** Dense but necessary. Lots of fields.

**Score:** Visual 6/10, Usability 8/10

**What Needs to Change:**
- The form is very long when open. Consider tabs or sections for organization.
- No draft preview — can't see how the production will look on the public page without publishing.
- No undo for deletes (soft delete happens immediately).
- Year field should be a number input with a reasonable range.

---

### 29. ADMIN RENTALS — `/admin/rentals`

**First Impression:** Mirrors Admin Projects but with rental-specific fields (pricing, availability, quantity, deposit, metadata key-value pairs). Same quality.

**Navigation:** Same as Projects.

**Visual Richness:** Same as Projects.

**Usability:** Same quality. Additional complexity handled well (metadata key-value pairs, rental_includes list, features list).

**Mobile:** Same concerns as Projects.

**Content Density:** Even denser than Projects due to more fields.

**Score:** Visual 6/10, Usability 8/10

**What Needs to Change:**
- Same issues as Projects admin.
- The metadata key-value editor is functional but unlabeled — users don't know what metadata to add.
- Currency is hardcoded to ZAR. If expanding beyond South Africa, this needs to be selectable.

---

### 30. ADMIN CAREERS — `/admin/careers`

**First Impression:** Clean, minimal CRUD. No image support (appropriate — careers don't need images). Supabase-backed.

**Navigation:** List → Create/Edit form.

**Visual Richness:** LOW but appropriate for admin. Publish status dots, action buttons with hover states.

**Usability:** Good. Employment type dropdown, requirements as one-per-line textarea, publish toggle. Inline form.

**Mobile:** Works. Simple layout.

**Content Density:** Light. Appropriate.

**Score:** Visual 5/10, Usability 7/10

**What Needs to Change:**
- No confirmation dialog on delete. Soft delete happens immediately.
- Requirements textarea needs a helper hint visible in the UI, not just a placeholder.
- No salary range field. Job seekers expect this.

---

### 31. ADMIN PRESS — `/admin/press`

**First Impression:** Best admin panel after Projects. Has cover image upload with cropping (react-easy-crop), full article editing (title, slug, content, excerpt, author, category, published_at), featured toggle.

**Navigation:** List → Create/Edit form → Image crop modal.

**Visual Richness:** MEDIUM. Cover image preview, crop modal, list items with tiny cover thumbnails and featured star icons.

**Usability:** Good. Same patterns as Projects admin. Slug auto-generated. Date field for published_at.

**Mobile:** Same concerns as Projects.

**Content Density:** Moderate.

**Score:** Visual 6/10, Usability 8/10

**What Needs to Change:**
- Content editing is a plain textarea. For a press/blog system, a rich text editor (Tiptap, MDX) would be much better.
- No image upload within article content — only a cover image.
- No preview mode.

---

### 32. ADMIN BOOKINGS — `/admin/bookings`

**First Impression:** Well-structured data table. Tabs, search, status filter, paginated results, inline actions (confirm/cancel). Uses shared UI components throughout.

**Navigation:** Tabs → Search + Filter → Results table → Actions.

**Visual Richness:** MEDIUM. Status badges, table layout with hover rows, action icons. Clean.

**Usability:** Excellent. Search works across equipment name, user email, user name. Status filter dropdown. Pagination. Confirm/cancel buttons on pending bookings.

**Mobile:** Table collapses to stacked cards on mobile (grid layout adapts).

**Content Density:** Dense but manageable with pagination.

**Score:** Visual 7/10, Usability 9/10

**What Needs to Change:**
- "View details" button exists but doesn't link to anything. Should open a booking detail modal or page.
- No export to CSV/Excel. Admin staff will need this for accounting.
- No revenue summary at the top (total revenue, pending revenue, etc.).

---

### 33. ADMIN VERIFICATIONS — `/admin/verifications`

**First Impression:** Purpose-built review interface. Expandable rows with document preview, approve/reject actions with optional rejection reason. Appropriate for the workflow.

**Navigation:** List → Expand → Review documents → Approve/Reject.

**Visual Richness:** MEDIUM. Status badges with icons, expandable sections with border transitions, document preview (images inline, PDFs as links).

**Usability:** Good. Two-step reject (click → show reason input → click again). Document images viewable inline. Status updates refresh the list.

**Mobile:** Expandable sections work on mobile. Document images scale.

**Content Density:** Light initially, dense when expanded.

**Score:** Visual 6/10, Usability 8/10

**What Needs to Change:**
- No way to see how many submissions are pending without counting. Add a pending count badge in the header.
- Document images should open in a lightbox/modal for full inspection, not just inline thumbnails.
- No audit trail — who approved/rejected and when.

---

### 34. SMART RENTALS CATEGORY INDEX — `/smart-rentals/[category]`

*(Covered as a server component wrapper for RentalCategoryClient — see #15 above.)*

---

## Summary: Top 5 Pages (Best Design)

| Rank | Page | Visual | Usability | Notes |
|------|------|--------|-----------|-------|
| 1 | Home (`/`) | 8 | 8 | Sets the benchmark. Parallax, grid textures, horizontal gallery. |
| 2 | Catalog Detail (`/catalog/[slug]`) | 9 | 8 | Only page using `next/image` + gradient hero + zoom animation. |
| 3 | Rental Category (`/smart-rentals/[category]`) | 8 | 9 | Best filter UX. Cinematic image treatment. Mobile modal. |
| 4 | Admin Dashboard (`/admin`) | 8 | 9 | Excellent KPI layout. Activity feed. Featured grid. |
| 5 | Smart Rentals Index (`/smart-rentals`) | 8 | 8 | Cinematic category grid. Strong hover effects. |

## Summary: Bottom 5 Pages (Need Most Work)

| Rank | Page | Visual | Usability | Notes |
|------|------|--------|-----------|-------|
| 1 | Dashboard (`/dashboard`) | 2 | 3 | Three zeros and a gray box. Devastating first impression for new users. |
| 2 | Creator Profile (`/creators/[id]`) | 4 | 6 | No portfolio, no listings, no way to contact. Useless as a profile. |
| 3 | Legal/Privacy | 3 | 7 | Functional but zero visual treatment. |
| 4 | Listings (`/dashboard/listings`) | 4 | 7 | No image upload for gear listings. Absurd for a rental platform. |
| 5 | Locations (`/locations`) | 5 | 5 | Two cards and fake phone numbers. Should be merged into Contact. |

---

## Critical Fixes (Priority Order)

### Tier 1: Broken Trust
1. **Dashboard empty state** — New users see nothing useful. Add onboarding flow, quick actions, and real data counts.
2. **Careers "Apply Now" buttons** — Not clickable. Wire to email or application form.
3. **Tech Support ticket form** — Submits to nothing. Wire to API or remove.
4. **Press "Read Article" links** — No detail pages exist. Create `/press/[slug]` route.
5. **Listings without images** — A gear rental listing without photos will never get booked. Add image upload.

### Tier 2: Visual Quality
6. **Replace all `<img>` with `next/image`** — Especially on Smart Productions, Smart Rentals, and the home page gallery.
7. **Unify Rental Detail and Catalog Detail** — Catalog has the better design. Apply it everywhere.
8. **Creator Profile needs portfolio section** — Grid of their work, active listings, review score.
9. **Add skeleton loading states** — Replace spinners with content-shaped placeholders.
10. **Add a brand accent color** — The monochrome palette needs a warm accent. Consider a gold/amber or a deep orange to evoke South African warmth.

### Tier 3: Content & Trust
11. **Replace all Unsplash images** with real studio/location/equipment photography.
12. **Fix fake data** — JHB coordinates (not LA), real phone numbers, real social links.
13. **Home page hero image** — Replace generic neon arcade with actual production footage.
14. **Locations page** — Either use real photos and real partnerships or merge into Contact.
15. **"Coming Soon" labels** — For features not yet live (AI Studio, some tools), add clear "In Development" badges.

### Tier 4: Missing Features
16. **Forgot Password flow** on Login page.
17. **Article detail pages** for Press.
18. **Search** on Smart Productions page.
19. **Sort options** on Rental Category pages.
20. **Calendar view** for dashboard bookings.




