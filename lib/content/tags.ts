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

export function displayTag(tag: string): string {
  return TAG_FIXES[tag.trim().toLowerCase()] ?? tag;
}
