import { jsPDF } from 'jspdf';
import { STUDIO } from '@/lib/constants';

// ─── Types ──────────────────────────────────────────────────────────────────

export type QuoteLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type QuoteData = {
  quoteNumber: string;
  date: string;
  validUntil: string;
  clientName: string;
  clientEmail: string;
  projectType: string;
  location?: string;
  preferredDates?: string;
  deliverables?: string;
  creatorName?: string;
  lineItems: QuoteLineItem[];
  subtotal: number;
  vatAmount: number;
  total: number;
  notes?: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatZAR(amount: number): string {
  return `R ${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function generateQuoteNumber(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `TVQ-${datePart}-${randomPart}`;
}

// ─── PDF Generation ─────────────────────────────────────────────────────────

const GOLD = '#D4A843';
const DARK = '#050505';
const GREY = '#666666';
const LIGHT_GREY = '#F5F5F5';

export function generateQuotePDF(data: QuoteData): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // ── Header bar ──
  doc.setFillColor(DARK);
  doc.rect(0, 0, pageWidth, 45, 'F');

  doc.setTextColor(GOLD);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(STUDIO.shortName.toUpperCase(), margin, 22);

  doc.setTextColor('#FFFFFF');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(STUDIO.tagline, margin, 30);

  // Quote label — right aligned
  doc.setTextColor(GOLD);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('QUOTE', pageWidth - margin, 22, { align: 'right' });

  doc.setTextColor('#FFFFFF');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`#${data.quoteNumber}`, pageWidth - margin, 30, { align: 'right' });

  y = 55;

  // ── Quote details + Client info (two columns) ──
  doc.setTextColor(GREY);
  doc.setFontSize(8);
  doc.text('QUOTE DATE', margin, y);
  doc.text('VALID UNTIL', margin + 45, y);
  doc.text('PREPARED FOR', pageWidth / 2 + 10, y);

  y += 5;
  doc.setTextColor(DARK);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(data.date, margin, y);
  doc.text(data.validUntil, margin + 45, y);
  doc.text(data.clientName, pageWidth / 2 + 10, y);

  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(GREY);
  doc.text(data.clientEmail, pageWidth / 2 + 10, y);

  y += 12;

  // ── Project Details ──
  doc.setFillColor(LIGHT_GREY);
  doc.rect(margin, y, contentWidth, 8, 'F');
  doc.setTextColor(DARK);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('PROJECT DETAILS', margin + 4, y + 5.5);
  y += 12;

  const details: [string, string][] = [
    ['Project Type', data.projectType],
    ...(data.creatorName ? [['Creator', data.creatorName] as [string, string]] : []),
    ...(data.location ? [['Location', data.location] as [string, string]] : []),
    ...(data.preferredDates ? [['Preferred Dates', data.preferredDates] as [string, string]] : []),
    ...(data.deliverables ? [['Deliverables', data.deliverables] as [string, string]] : []),
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  for (const [label, value] of details) {
    doc.setTextColor(GREY);
    doc.text(`${label}:`, margin + 4, y);
    doc.setTextColor(DARK);
    doc.text(value, margin + 40, y);
    y += 5.5;
  }

  y += 8;

  // ── Line Items Table ──
  // Header
  doc.setFillColor(DARK);
  doc.rect(margin, y, contentWidth, 8, 'F');
  doc.setTextColor('#FFFFFF');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('DESCRIPTION', margin + 4, y + 5.5);
  doc.text('QTY', margin + 100, y + 5.5, { align: 'center' });
  doc.text('UNIT PRICE', margin + 125, y + 5.5, { align: 'right' });
  doc.text('TOTAL', margin + contentWidth - 4, y + 5.5, { align: 'right' });
  y += 10;

  // Rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  for (let i = 0; i < data.lineItems.length; i++) {
    const item = data.lineItems[i];
    if (i % 2 === 0) {
      doc.setFillColor('#FAFAFA');
      doc.rect(margin, y - 3, contentWidth, 7, 'F');
    }
    doc.setTextColor(DARK);
    doc.text(item.description, margin + 4, y + 1);
    doc.text(String(item.quantity), margin + 100, y + 1, { align: 'center' });
    doc.text(formatZAR(item.unitPrice), margin + 125, y + 1, { align: 'right' });
    doc.text(formatZAR(item.total), margin + contentWidth - 4, y + 1, { align: 'right' });
    y += 7;
  }

  y += 4;

  // ── Totals ──
  const totalsX = margin + contentWidth - 70;
  doc.setDrawColor('#DDDDDD');
  doc.line(totalsX, y, margin + contentWidth, y);
  y += 6;

  doc.setTextColor(GREY);
  doc.setFontSize(9);
  doc.text('Subtotal', totalsX, y);
  doc.setTextColor(DARK);
  doc.text(formatZAR(data.subtotal), margin + contentWidth - 4, y, { align: 'right' });
  y += 6;

  doc.setTextColor(GREY);
  doc.text(`VAT (${STUDIO.booking.vatRate}%)`, totalsX, y);
  doc.setTextColor(DARK);
  doc.text(formatZAR(data.vatAmount), margin + contentWidth - 4, y, { align: 'right' });
  y += 6;

  doc.setDrawColor('#DDDDDD');
  doc.line(totalsX, y, margin + contentWidth, y);
  y += 6;

  doc.setFillColor(DARK);
  doc.rect(totalsX - 4, y - 4, contentWidth - totalsX + 8, 10, 'F');
  doc.setTextColor('#FFFFFF');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL', totalsX, y + 2.5);
  doc.setTextColor(GOLD);
  doc.text(formatZAR(data.total), margin + contentWidth - 4, y + 2.5, { align: 'right' });

  y += 18;

  // ── Notes ──
  if (data.notes) {
    doc.setTextColor(GREY);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('Notes:', margin, y);
    y += 4;
    doc.setTextColor(DARK);
    const noteLines = doc.splitTextToSize(data.notes, contentWidth - 8);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 4 + 4;
  }

  // ── Cancellation Policy ──
  doc.setTextColor(GREY);
  doc.setFontSize(7);
  doc.text(`Cancellation Policy: ${STUDIO.booking.cancellationPolicy}`, margin, y);
  y += 4;
  doc.text(`Platform Commission: ${STUDIO.booking.platformCommission}% (included in pricing)`, margin, y);

  // ── Footer ──
  const footerY = doc.internal.pageSize.getHeight() - 15;
  doc.setDrawColor(GOLD);
  doc.setLineWidth(0.5);
  doc.line(margin, footerY - 5, pageWidth - margin, footerY - 5);

  doc.setTextColor(GREY);
  doc.setFontSize(7);
  doc.text(
    `${STUDIO.legal.companyName} | ${STUDIO.phone} | ${STUDIO.email} | ${STUDIO.meta.url}`,
    pageWidth / 2,
    footerY,
    { align: 'center' },
  );

  // Return as Buffer
  return Buffer.from(doc.output('arraybuffer'));
}

export { generateQuoteNumber };
