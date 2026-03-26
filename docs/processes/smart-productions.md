# SMART PRODUCTIONS — System Design & Implementation Guide

## Overview

Smart Productions is ThabangVision's service catalogue and portfolio system. It serves two purposes:
1. **Service Catalogue** — clients browse production categories and book pre-built packages
2. **Portfolio Proof** — real work uploaded by admin proves the quality of each package

Every production uploaded creates three revenue opportunities:
- Client books the same package → production services revenue
- Client rents the same gear → rental revenue
- Client hires the same creator → crew commission revenue

---

## Architecture

```
ADMIN CREATES:                    CLIENT SEES:
──────────────                    ────────────

production_categories table   →   Category cards with images
  (name, image, rate)              "Weddings & Ceremonies"
                                   "From R9,000"
         │
         ▼
PRODUCTION_PACKAGES constants →   Package cards with calculated prices
  (services, hours, deliverables)  "Wedding Premium"
  price auto-calculated from       "R38,525 incl VAT"
  PRODUCTION_SERVICES rates        [BOOK THIS PACKAGE]
         │
         ▼
smart_productions table       →   Portfolio proof below packages
  (photos, creator, gear)          Real work filtered by category + package
  linked to category + package     "Shot by Thabang M. on Sony A7 III"
         │
         ▼
smart_rentals table           →   "Shot with" gear links
  (gear used in production)        [Sony A7 III — R750/day → Rent]
         │
         ▼
profiles table                →   Creator credit
  (who did the work)               [Thabang M. → View profile]
```

---

## Data Model

### 1. Production Categories (database-driven)

Table: `production_categories`

```sql
create table if not exists production_categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  sub_types text[] default '{}',
  cover_image_url text,
  cover_image_public_id text,
  gallery_urls text[] default '{}',
  starting_rate integer,
  starting_unit text default 'session',
  icon text,
  display_order integer default 0,
  is_published boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Categories are managed from the admin panel. Admin can:
- Add/edit/delete categories
- Upload cover images and gallery images via Cloudinary
- Set starting rate and unit
- Reorder categories
- Publish/unpublish

**Six default categories:**

| Slug | Name | Sub-types | Starting Unit |
|------|------|-----------|---------------|
| photography | Photography | Portrait & Headshot, Product & Commercial, Real Estate & Interior, Fashion & Editorial | session |
| video-production | Video Production | Music Video, Documentary, Short Film, Promo & Ad | project |
| weddings-ceremonies | Weddings & Ceremonies | Wedding (Photo + Video), Lobola & Umembeso, Matric Dance, Graduation, Baby Shower | package |
| event-coverage | Event Coverage | Corporate Conference, Product Launch, Concert & Festival, Birthday & Private | event |
| content-creation | Content Creation | Social Media (IG/TikTok), YouTube, Brand Content, Influencer Shoot | session |
| corporate-brand | Corporate & Brand | Team Headshots, Office & Culture, Product Photography, Annual Report, Brand Film | project |

These are client-friendly labels. Not industry jargon. A client looking for "I need wedding photos" finds "Weddings & Ceremonies" instantly.

### 2. Production Packages (constants-driven)

Location: `lib/constants.ts` → `PRODUCTION_PACKAGES`

Packages are defined in code because they reference PRODUCTION_SERVICES rates. Prices are auto-calculated — never hardcoded. When rates change, all package prices update automatically.

**Package structure:**

```typescript
interface ProductionPackage {
  id: string;                    // unique slug: 'wedding-premium'
  name: string;                  // display name: 'Wedding Premium'
  category: string;              // matches production_categories.slug
  duration: number;              // total hours
  services: {
    type: string;                // 'photography' | 'cinematography' | 'postProduction'
    subType: string;             // matches PRODUCTION_SERVICES sub-keys
    hours: number;
  }[];
  deliverables: string[];        // what client receives
  popular: boolean;              // shows "MOST POPULAR" badge
}
```

**Price calculation:**

```typescript
function calculatePackagePrice(pkg: ProductionPackage): {
  subtotal: number;
  vat: number;
  total: number;
  lineItems: { service: string; hours: number; rate: number; amount: number }[];
} {
  const lineItems = [];
  let subtotal = 0;

  for (const service of pkg.services) {
    const rate = PRODUCTION_SERVICES[service.type][service.subType].rate;
    const amount = rate * service.hours;
    subtotal += amount;
    lineItems.push({
      service: `${service.type} — ${service.subType}`,
      hours: service.hours,
      rate,
      amount,
    });
  }

  const vat = Math.round(subtotal * (PRODUCTION_SERVICES.billing.vatRate / 100));
  const total = subtotal + vat;

  return { subtotal, vat, total, lineItems };
}
```

All prices displayed as: `R{total} incl. VAT`

### 3. Smart Productions (admin-uploaded work)

Table: `smart_productions`

```sql
-- Required columns for the Smart Productions system:
-- id, title, slug, description
-- production_category_id (references production_categories)
-- package_id (matches PRODUCTION_PACKAGES[].id in constants)
-- cover_image_url, gallery_urls
-- crew_ids (uuid[] — references profiles of creators involved)
-- gear_used (text[] — slugs of smart_rentals items used)
-- image_metadata (jsonb — EXIF data extracted from photos)
-- client_testimonial (text)
-- client_name (text — first name only for display)
-- is_published (boolean)
-- is_featured (boolean — featured productions shown as category hero)
-- created_at, updated_at
```

Each production links to:
- A category (which category page it appears under)
- A package (which package it serves as proof for)
- Creators (who did the work — links to Smart Creators profiles)
- Gear (what equipment was used — links to Smart Rentals items)

---

## Admin Workflow

### Adding a new production:

```
1. Admin does a shoot (e.g., wedding)
2. Goes to /admin/productions → "Add Production"
3. Fills in:
   - Title: "Ntando & Thandi Wedding"
   - Category: Weddings & Ceremonies (dropdown from production_categories)
   - Package: Wedding Premium (dropdown from PRODUCTION_PACKAGES)
   - Upload 10-20 best photos → Cloudinary
   - EXIF auto-extracted from photos (camera, lens, settings, GPS)
   - Tag creator(s): search by name → select (links to profiles)
   - Tag gear: search by name → select (links to smart_rentals)
   - Client testimonial: "Amazing experience..." (optional)
   - Client name: "Ntando M." (first name + initial only)
   - Featured: yes/no (featured = hero image for category)
4. Click Publish
5. Production appears:
   - Under its category on /smart-production
   - As proof under the matching package
   - In portfolio grid with category filter
   - Gear links connect to Smart Rentals
   - Creator credit connects to Smart Creators
```

### Managing categories:

```
1. Go to /admin/production-categories
2. Each category shows:
   - Cover image (upload/change)
   - Gallery images
   - Name, description, sub-types
   - Starting rate and unit
   - Display order
   - Published toggle
3. Same UI pattern as /admin/rentals
4. Drag to reorder or set display_order number
```

---

## Public Pages

### Main page: `/smart-production`

```
SECTION 1 — HERO
  "Our productions speak for themselves"
  "From weddings to music videos — professional results, every time."

SECTION 2 — SERVICE CATEGORIES
  6 cards in 3x2 grid from production_categories table
  Each shows:
  - Cover image (from database or first featured production)
  - Category name
  - Sub-types as small text list
  - "From R{starting_rate} per {starting_unit}"
  - [VIEW PACKAGES] → scrolls to packages or links to /smart-production/category/[slug]

SECTION 3 — PACKAGES
  All packages from PRODUCTION_PACKAGES
  Grouped by category OR shown as filterable list
  Each package card shows:
  - Package name
  - Category tag
  - Duration
  - Deliverables as checklist with checkmarks
  - Auto-calculated price from PRODUCTION_SERVICES: "R{total} incl. VAT"
  - "MOST POPULAR" badge if popular: true
  - Example work thumbnail (from smart_productions where package_id matches)
  - [BOOK THIS PACKAGE] → /book?package={id}

SECTION 4 — PORTFOLIO / RECENT WORK
  Grid of smart_productions entries
  Filter tabs matching the 6 categories:
    All | Photography | Video | Weddings | Events | Content | Corporate
  Each card shows:
  - Cover image
  - Title
  - Category tag
  - "Shot with" gear → links to /smart-rentals/[slug]
  - "By" creator name → links to /smart-creators/[slug]
  - Click → /smart-production/[slug]

SECTION 5 — CUSTOM QUOTE
  "Need something different?"
  "Every project is unique. Tell us what you need."
  [ASK UBUNYE FOR A QUOTE] → /ubunye-ai-studio?prompt=I need a custom production quote
  [SEND US A BRIEF] → /contact?type=production_brief
```

### Category page: `/smart-production/category/[slug]`

```
  HERO: category cover image + name + description
  PACKAGES: filtered to this category only
  PORTFOLIO: smart_productions filtered to this category
  CUSTOM QUOTE CTA
```

### Production detail page: `/smart-production/[slug]`

```
  Full gallery (swipeable on mobile)
  Title and description
  Category and package tags
  
  "SHOT WITH" section:
  - Gear items from gear_used array
  - Each links to /smart-rentals/[category]/[slug]
  - Shows gear name + daily rate + [Rent this gear]
  
  "CREATED BY" section:
  - Creator(s) from crew_ids
  - Avatar + name + specialization
  - Links to /smart-creators/[slug]
  - [Book this creator]
  
  "TECHNICAL DETAILS" (from EXIF):
  - Camera: Sony ILCE-7M3
  - Lens: FE 85mm f/1.8
  - Settings: f/2.8, ISO 800, 1/200s
  - Location: Sandton, Johannesburg
  
  "CLIENT REVIEW" (if exists):
  - Star rating
  - Testimonial text
  - Client first name + initial
  
  "BOOK SIMILAR" CTA:
  - Shows the package used for this production
  - Package price
  - [BOOK THIS PACKAGE] → /book?package={package_id}
  
  RELATED WORK:
  - Other productions in the same category
  - 3-4 cards in a row
```

---

## Cross-Sell Engine

Every production creates three cross-sell paths:

```
Path 1: Production → Package → Booking
  Client sees work → wants same result → books the package
  Revenue: production services

Path 2: Production → Gear → Rental
  Client sees "Shot on Sony A7 III" → wants same gear
  Clicks → lands on rental page → rents it
  Revenue: gear rental

Path 3: Production → Creator → Crew booking
  Client sees "Created by Thabang M." → wants same creator
  Clicks → lands on creator profile → books them
  Revenue: crew commission (15%)
```

All three paths exist on every production detail page. No extra work needed — the connections are made when admin tags creator and gear during upload.

---

## Image Sourcing Rules

No duplicate uploads. Images flow from one source:

```
Category cover image:
  Source: production_categories.cover_image_url (uploaded by admin)
  Fallback: cover_image_url from first featured production in that category
  Fallback: PLACEHOLDER_IMAGES.smartProductions from constants

Package card thumbnail:
  Source: cover_image_url from smart_productions where package_id matches
  Fallback: category cover image
  Fallback: placeholder

Portfolio grid:
  Source: smart_productions.cover_image_url and gallery_urls
  Filtered by category
  
Production detail:
  Source: smart_productions.gallery_urls (full gallery)
```

As admin uploads more productions, the page gets richer automatically. New wedding shoot → wedding category shows fresher work. No code changes needed.

---

## Pricing Rules

All pricing comes from `PRODUCTION_SERVICES` in `lib/constants.ts`. Never hardcoded.

```
Category starting rates:
  Stored in production_categories.starting_rate
  Updated by admin when rates change
  Displayed as: "From R{rate} per {unit}"

Package prices:
  Calculated at render time from PRODUCTION_SERVICES rates
  Formula: sum(service.hours × service.rate) + VAT
  Displayed as: "R{total} incl. VAT"

When admin updates PRODUCTION_SERVICES rates:
  → All package prices update automatically
  → Category starting rates need manual update in admin panel
  → OR: calculate starting rate as min(package prices in category)
```

---

## Ubunye Integration

Update system prompt to include package awareness:

```
When a client asks about production services or pricing:
1. Reference PRODUCTION_PACKAGES
2. Calculate prices using the same formula as the page
3. Present relevant packages as options:
   "For a wedding, we have two packages:
    Wedding Essentials — R12,650 incl. VAT
    Includes: 6 hours, 150 photos, online gallery.
    
    Wedding Premium — R38,525 incl. VAT
    Includes: 10 hours, 300 photos, 3-min highlight reel, full ceremony edit.
    
    Which suits your needs? Or I can build a custom quote."

4. If client wants custom: calculate from hourly rates
5. If client wants to book: link to /book?package={id}
```

---

## Booking Integration

When client clicks [BOOK THIS PACKAGE]:
1. Links to `/book?package={package_id}`
2. `/book` page reads package ID from URL
3. Looks up package from PRODUCTION_PACKAGES in constants
4. Auto-fills: services, hours, deliverables
5. Calculates total from PRODUCTION_SERVICES rates
6. Shows summary + Paystack payment button
7. Same booking flow as TASK-039

---

## API Routes

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | /api/production-categories | Public | List published categories |
| GET | /api/productions | Public | List published productions |
| GET | /api/productions/[slug] | Public | Production detail |
| POST | /api/admin/production-categories | Admin | Create category |
| PATCH | /api/admin/production-categories/[id] | Admin | Update category |
| DELETE | /api/admin/production-categories/[id] | Admin | Delete category |
| POST | /api/admin/productions | Admin | Create production |
| PATCH | /api/admin/productions/[id] | Admin | Update production |
| DELETE | /api/admin/productions/[id] | Admin | Delete production |

---

## Admin Panel Pages

```
/admin/production-categories
  - List, create, edit, reorder categories
  - Upload cover images and gallery
  - Manage sub-types, rates, descriptions

/admin/productions
  - List all productions with status badges
  - Create new: title, category, package, photos, creator, gear, testimonial
  - Edit existing
  - Publish/unpublish
  - Featured toggle (featured = category hero image)
  - EXIF auto-extraction on photo upload
```

---

## Migration Path

```
Phase 1 (now):
  - Categories in database (admin manages)
  - Packages in constants.ts (developer manages)
  - Productions in database (admin uploads)
  - Prices calculated from PRODUCTION_SERVICES

Phase 2 (later):
  - Move packages to database too
  - Admin creates custom packages from dashboard
  - Dynamic pricing rules
  - Seasonal pricing

Phase 3 (future):
  - Creators create their own packages
  - Marketplace of production services
  - Client reviews per package
  - AI-recommended packages based on brief
```

---

## Key Rules

1. **All prices from PRODUCTION_SERVICES** — never hardcoded
2. **Categories in database** — admin manages from dashboard
3. **Packages in constants** — calculated prices, developer manages for now
4. **Productions link to categories + packages + creators + gear**
5. **No duplicate image uploads** — one source of truth per image
6. **EXIF auto-extracted** on upload — not manual
7. **Cross-sell on every production** — gear links + creator links + book similar
8. **Client language only** — "Photography" not "Imaging Services"
9. **Social links hidden** on creator credits — book through platform only
10. **Portfolio builds itself** — more uploads = richer page, no code changes
