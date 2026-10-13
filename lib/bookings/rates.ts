/**
 * The hourly rate charged for a shoot type. Pure, with no server imports, so
 * the booking form (a client component) quotes exactly what
 * POST /api/service-bookings charges. Moved unchanged from
 * lib/supabase/queries/service-bookings.ts, which re-exports it.
 */
export function getHourlyRate(category: string): number {
  const cat = category.toLowerCase();

  // Order matters: these are substring tests, so the most specific and the
  // higher-priced patterns must be checked first. Previously 'portrait' and
  // 'product' were tested before the cinematography list, so "product video"
  // and "corporate video portrait" both priced at the photography rate.
  // project_category arrives here as free text from the booking tool, which
  // made that underpricing steerable from chat.
  if (
    cat.includes('cinematography') ||
    cat.includes('music video') ||
    cat.includes('corporate video') ||
    cat.includes('documentary') ||
    cat.includes('short film') ||
    cat.includes('video')
  ) {
    return 2850;
  }
  // Photography categories
  if (cat.includes('portrait') || cat.includes('product') || cat.includes('real estate') || cat.includes('corporate photo')) {
    return 1500;
  }
  // Event/wedding - use photography rate as base
  if (cat.includes('wedding photo') || cat.includes('event')) {
    return 1500;
  }
  if (cat.includes('wedding cinematography')) {
    return 2850;
  }
  // Content creation - mid-range
  if (cat.includes('content')) {
    return 1500;
  }
  // Default to photography rate
  return 1500;
}

