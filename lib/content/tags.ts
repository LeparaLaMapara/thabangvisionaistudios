import { RENTAL_CATEGORIES } from '@/lib/constants';

/**
 * Tags are typed by hand in the admin and shown to customers as they are.
 * A few carried typos or shorthand ("Potraits", "BnW"). This fixes the
 * display without touching the stored tags; fix the rows in /admin too.
 */
const TAG_FIXES: Record<string, string> = {
  potraits: 'Portraits',
  potrait: 'Portrait',
  bnw: 'Black and white',
  'b&w': 'Black and white',
};

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(RENTAL_CATEGORIES.map((c) => [c.value, c.label]));

/** "prime-lens" -> "Prime lens". A slug is internal; a visitor reads words. */
function slugToWords(slug: string): string {
  const words = slug.trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Looks like a slug: lower-case words joined by hyphens or underscores. */
const SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/;

/**
 * The human name of a rental category slug: "cameras-optics" -> "Cameras &
 * Optics". One source for every page; an unknown slug becomes plain words.
 */
export function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? slugToWords(slug);
}

/**
 * A tag as a visitor should read it. Category slugs ("aerial-support") show
 * their category name, other slugs ("prime-lens") become words, and typed
 * tags with spaces or capitals are kept as written.
 */
export function displayTag(tag: string): string {
  const key = tag.trim().toLowerCase();
  if (TAG_FIXES[key]) return TAG_FIXES[key];
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  if (SLUG.test(key)) return slugToWords(key);
  return tag;
}
