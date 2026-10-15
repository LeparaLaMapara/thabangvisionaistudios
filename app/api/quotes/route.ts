export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, checkRateLimit } from '@/lib/auth';
import { generateQuotePDF, generateQuoteNumber, quoteTotals } from '@/lib/pdf/quote';
import type { QuoteData, QuoteLineItem } from '@/lib/pdf/quote';
import { STUDIO } from '@/lib/constants';

// ─── POST /api/quotes — Generate a PDF quote ───────────────────────────────

// Staff only (security re-check 2026-10-15, M7): prices come from the body,
// so any signed-in person could print official-looking ThabangVision quotes
// with any prices. Nothing in the site calls this route.
const MAX_QUOTE_ITEMS = 30;

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  if (!(await checkRateLimit(`quotes:${gate.user.id}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many quotes. Wait a moment.' }, { status: 429 });
  }

  let body: {
    clientName?: string;
    clientEmail?: string;
    projectType?: string;
    durationHours?: number;
    location?: string;
    preferredDates?: string;
    deliverables?: string;
    creatorName?: string;
    hourlyRate?: number;
    notes?: string;
    additionalItems?: { description: string; quantity: number; unitPrice: number }[];
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { clientName, clientEmail, projectType, durationHours } = body;

  if (!clientName || !clientEmail || !projectType || !durationHours) {
    return NextResponse.json(
      { error: 'clientName, clientEmail, projectType, and durationHours are required.' },
      { status: 400 },
    );
  }

  if (durationHours < STUDIO.booking.minBookingHours || durationHours > STUDIO.booking.maxBookingHours) {
    return NextResponse.json(
      { error: `Duration must be between ${STUDIO.booking.minBookingHours} and ${STUDIO.booking.maxBookingHours} hours.` },
      { status: 400 },
    );
  }

  // Build line items
  const hourlyRate = body.hourlyRate ?? 0;
  const lineItems: QuoteLineItem[] = [
    {
      description: `${projectType} — Production Services`,
      quantity: durationHours,
      unitPrice: hourlyRate,
      total: durationHours * hourlyRate,
    },
  ];

  // Add any additional items
  if (Array.isArray(body.additionalItems) && body.additionalItems.length > MAX_QUOTE_ITEMS) {
    return NextResponse.json({ error: `At most ${MAX_QUOTE_ITEMS} extra lines.` }, { status: 400 });
  }
  if (body.additionalItems?.length) {
    for (const item of body.additionalItems) {
      lineItems.push({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.quantity * item.unitPrice,
      });
    }
  }

  // VAT comes from the dated tax rule (0 while not VAT-registered).
  const { subtotal, vatAmount, total } = quoteTotals(lineItems);

  const now = new Date();
  const validUntil = new Date(now);
  validUntil.setDate(validUntil.getDate() + 30);

  const quoteData: QuoteData = {
    quoteNumber: generateQuoteNumber(),
    date: now.toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' }),
    validUntil: validUntil.toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' }),
    clientName,
    clientEmail,
    projectType,
    location: body.location,
    preferredDates: body.preferredDates,
    deliverables: body.deliverables,
    creatorName: body.creatorName,
    lineItems,
    subtotal,
    vatAmount,
    total,
    notes: body.notes,
  };

  try {
    const pdfBuffer = generateQuotePDF(quoteData);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="ThabangVision-Quote-${quoteData.quoteNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[quotes] PDF generation error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to generate quote.' }, { status: 500 });
  }
}
