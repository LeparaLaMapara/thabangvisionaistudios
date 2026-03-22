Major user feedback received. Fix these issues in priority order.

Read CLAUDE.md and MEMORY.md first.

=== CRITICAL — LANDING PAGE CLARITY ===

1. REPLACE HERO MESSAGE:
   Old: "We Engineer The Invisible" + "multidisciplinary laboratory fusing optical physics..."
   New: "Book South Africa's Best Creators and Gear"
   Subtitle: "Photography. Film. Production. Powered by AI."
   
   Two CTAs:
   [BOOK A CREATOR] → /smart-creators
   [RENT GEAR] → /smart-rentals

2. SIMPLIFY NAV:
   Old: THE LAB | CAPABILITIES | PRICING
   New: CREATORS | RENTALS | PRODUCTIONS | PRICING
   
   Move "The Lab" and "Ubunye AI Studio" to footer links.
   They're not what visitors need first.

3. FIX "SELECTED WORKS" CAROUSEL:
   - Remove gear listings from this section (DJI Mini, Sony 85mm are NOT "works")
   - Only show actual portfolio pieces (productions, shoots)
   - Create separate "FEATURED GEAR" section for rental items
   - Fix duplicate items appearing in the carousel

4. RESTRUCTURE HOME PAGE SECTIONS:
   Section 1: Hero — "Book Creators and Gear" (clear value prop)
   Section 2: How it works — Browse → Book → Pay → Create
   Section 3: Featured Creators (verified creator cards)
   Section 4: Featured Gear (top rental items with prices)
   Section 5: Recent Work (real productions only)
   Section 6: Ubunye AI — subtle mention, not centre stage
   Section 7: Trust signals (verified creators, secure payments, guarantee)

=== BROKEN FUNCTIONALITY ===

5. FIX DAILY RATE FILTER:
   - Cameras & Optics page shows "0 — Max: ZAR 0"
   - Slider not pulling actual price range from data
   - Should show real min/max from rental items

6. FIX PRICING BUTTONS:
   - "Upgrade Now" buttons on Pro Creator and Studio tiers have no href
   - Link them to /register or /dashboard/subscription

7. FIX NEWSLETTER SUBSCRIBE:
   - Footer shows "SUBSCRIBE" label with no email input field
   - Add email input + subscribe button
   - Or remove the section entirely if not implemented

8. FIX CMD+K SHORTCUT HINT:
   - Show "Ctrl+K" on Windows/Linux
   - Show "⌘K" on Mac only
   - Hide on mobile entirely

=== CONTENT FIXES ===

9. FIX SPELLING:
   - "Potraits" → "Portraits" (appears multiple times)
   - Search entire codebase for "Potrait" and fix all instances

10. FIX LOGO:
    - Nav reads "THAANGVISION" — missing the B
    - Should read "THABANGVISION" or use the new 4B logo SVG

11. REPLACE HERO IMAGE:
    - Currently uses generic Unsplash stock photo
    - Replace with real photo from ThabangVision shoots
    - Or use the video hero (STUDIO.hero.type = 'video') when ready

12. REMOVE OVERCLAIMED CONTENT:
    - "Optical Engineering — Building custom camera systems from scratch, designing proprietary lenses and sensors"
    - This is not real yet. Remove from The Lab page.
    - Only show what actually exists
    - Move aspirational content to a roadmap or blog post

13. FIX "SYSTEM STATUS" IN FOOTER:
    - "All Systems Nominal" and "LAT/LONG" coordinates
    - Either make them functional (link to real status page, link coords to Google Maps)
    - Or remove them — static decorative text that looks broken

14. COMMUNITY GEAR VS SMART RENTALS:
    - Both link to /smart-rentals
    - Either remove "Community Gear" as a separate nav item
    - Or add a filter on /smart-rentals: "Studio Gear" tab | "Community Gear" tab
    - Differentiate: studio-owned vs creator-listed

=== SOCIAL PROOF ===

15. ADD TRUST SIGNALS:
    - "X creators verified and listing gear"
    - "Secure payments via Paystack"  
    - "All creators identity-verified"
    - Even just "12 creators already listing" helps
    - Add a testimonials section when you have reviews

=== PERFORMANCE ===

16. IMAGE OPTIMIZATION:
    - Some images pulling 3840px versions
    - Add responsive sizes to all next/image components
    - Especially important for SA mobile users on data
    - Use: sizes="(max-width: 768px) 100vw, 50vw"

After all fixes: npm run build must pass. 
Do NOT change any backend functionality.
This is purely frontend and content fixes.