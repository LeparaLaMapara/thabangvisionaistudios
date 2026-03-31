export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateQuotePDF, generateQuoteNumber } from '@/lib/pdf/quote';
import type { QuoteData, QuoteLineItem } from '@/lib/pdf/quote';
import { STUDIO } from '@/lib/constants';

// ─── POST /api/quotes — Generate a PDF quote ───────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
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

  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const vatAmount = subtotal * (STUDIO.booking.vatRate / 100);
  const total = subtotal + vatAmount;

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
