import { chromium } from "playwright";
import { mkdirSync } from "fs";
import path from "path";

const BASE = "http://localhost:3000";
const OUT = "./screenshots";

mkdirSync(OUT, { recursive: true });

const ROUTES = [
  // Marketing
  { url: "/", name: "home" },
  { url: "/careers", name: "careers" },
  { url: "/contact", name: "contact" },
  { url: "/lab", name: "lab" },
  { url: "/legal", name: "legal" },
  { url: "/login", name: "login" },
  { url: "/register", name: "register" },
  { url: "/locations", name: "locations" },
  { url: "/press", name: "press" },
  { url: "/privacy", name: "privacy" },
  { url: "/support/tech", name: "support-tech" },

  // Platform
  { url: "/smart-production", name: "smart-production" },
  { url: "/smart-rentals", name: "smart-rentals" },
  { url: "/ubunye-ai-studio", name: "ubunye-ai-studio" },
  { url: "/pricing", name: "pricing" },
  { url: "/dashboard", name: "dashboard" },
  { url: "/dashboard/bookings", name: "dashboard-bookings" },
  { url: "/dashboard/listings", name: "dashboard-listings" },
  { url: "/dashboard/profile", name: "dashboard-profile" },
  { url: "/dashboard/verification", name: "dashboard-verification" },

  // Admin
  { url: "/admin", name: "admin" },
  { url: "/admin/projects", name: "admin-projects" },
  { url: "/admin/rentals", name: "admin-rentals" },
  { url: "/admin/careers", name: "admin-careers" },
  { url: "/admin/press", name: "admin-press" },
  { url: "/admin/bookings", name: "admin-bookings" },
  { url: "/admin/verifications", name: "admin-verifications" },
];

const VIEWPORTS = [
  { width: 1440, height: 900, suffix: "desktop" },
  { width: 390, height: 844, suffix: "mobile" },
];

async function run() {
  const browser = await chromium.launch({ headless: true });

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      colorScheme: "dark",
    });
    const page = await context.newPage();

    for (const route of ROUTES) {
      const filename = `${route.name}-${vp.suffix}.png`;
      const filepath = path.join(OUT, filename);
      try {
        console.log(`${vp.suffix} -> ${route.url}`);
        await page.goto(`${BASE}${route.url}`, {
          waitUntil: "networkidle",
          timeout: 30000,
        });
        // Wait a bit for animations to settle
        await page.waitForTimeout(1500);
        await page.screenshot({ path: filepath, fullPage: true });
        console.log(`   OK ${filename}`);
      } catch (err) {
        console.log(`   FAILED ${filename} -- ${err.message}`);
        // Try to capture whatever is on screen
        try {
          await page.screenshot({ path: filepath, fullPage: true });
          console.log(`   PARTIAL ${filename}`);
        } catch {}
      }
    }

    await context.close();
  }

  await browser.close();
  console.log("\nAll screenshots saved to ./screenshots/");
}

run().catch(console.error);
