export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { search } from '@/lib/search';
import type { SearchResponse } from '@/lib/search';

export type { SearchResultItem as SearchResult, SearchResponse } from '@/lib/search';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(`search:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [], counts: {} } satisfies SearchResponse);
  }

  // H2: Sanitize search input — escape PostgREST special characters to prevent filter injection
  const sanitized = q.replace(/[,.()"'\\%_]/g, '');
  if (!sanitized || sanitized.length < 2) {
    return NextResponse.json({ results: [], counts: {} } satisfies SearchResponse);
  }

  try {
    const response = await search.search(sanitized);
    return NextResponse.json(response satisfies SearchResponse);
  } catch (err) {
    console.error('[search] Error:', err);
    return NextResponse.json(
      { error: 'Search failed.' },
      { status: 500 },
    );
  }
}
