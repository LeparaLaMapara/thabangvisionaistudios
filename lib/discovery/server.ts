import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { clientIp } from '@/lib/http/clientIp';
import { availabilityFor } from '@/lib/rental/availability-server';
import { sastDate } from '@/lib/core/rental/notifications';
import { DISCOVERY_RATE_LIMITS, type AvailabilityCheck, type DateRange } from '@/lib/discovery/api';
import type { CatalogRental } from '@/lib/discovery/types';

/**
 * Server pieces shared by the machine endpoints (/v1, /mcp, llms, markdown
 * twins): rate limiting, caching headers and the availability check.
 */

/** CDN caching for catalogue answers: 5 minutes fresh, an hour stale while refreshing. */
export const DISCOVERY_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=3600';

/** A 429 response when this IP is over the limit, else null. */
export async function discoveryRateLimit(request: Request, bucket: keyof typeof DISCOVERY_RATE_LIMITS): Promise<Response | null> {
  const { max, windowMs } = DISCOVERY_RATE_LIMITS[bucket];
  const ok = await checkRateLimit(`discovery:${bucket}:${clientIp(request.headers)}`, max, windowMs);
  if (ok) return null;
  return NextResponse.json(
    { error: 'Too many requests. Slow down and try again in a minute.' },
    { status: 429, headers: { 'Retry-After': String(Math.ceil(windowMs / 1000)), 'Cache-Control': 'no-store' } },
  );
}

/** Today in South Africa, YYYY-MM-DD. */
export function todaySast(): string {
  return sastDate(new Date());
}

/** The real availability check: the same one the gear page and checkout use. */
export const checkRentalAvailability: AvailabilityCheck = async (r: CatalogRental, dates: DateRange) => {
  const res = await availabilityFor({ rentalId: r.id, stock: r.quantity, startDate: dates.start, endDate: dates.end });
  return res.available;
};

export function jsonResponse(body: unknown, init: { status?: number; cache?: boolean } = {}): Response {
  return NextResponse.json(body, {
    status: init.status ?? 200,
    headers: {
      'Cache-Control': init.cache === false ? 'no-store' : DISCOVERY_CACHE_CONTROL,
      'Access-Control-Allow-Origin': '*',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export function textResponse(body: string, contentType: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    headers: {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Cache-Control': DISCOVERY_CACHE_CONTROL,
      'Access-Control-Allow-Origin': '*',
      ...extra,
    },
  });
}
