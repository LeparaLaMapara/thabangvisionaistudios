export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getModel } from '@/lib/ai';
import { generateText } from 'ai';

// ─── POST — Extract rental items from a PDF rate card ────────────────────────

const EXTRACTION_PROMPT = `Extract all rental items from this rate card text. Return valid JSON only, no markdown, no code fences, no explanation. Just the JSON array.

The JSON array should contain objects with this structure:
[
  {
    "title": "item name",
    "category": "one of: cameras-optics, audio, lighting-power, grip-motion, data-storage, crew-services, specialized-solutions, aerial-support, sound-reinforcement",
    "sub_category": "subcategory if evident",
    "brand": "manufacturer",
    "model": "model name",
    "description": "specifications text",
    "features": ["feature1", "feature2"],
    "daily_rate": number,
    "weekly_rate": number,
    "deposit": number,
    "tags": ["tag1", "tag2"]
  }
]

Rules:
- If weekly_rate is not listed, calculate as daily_rate * 2.5
- If deposit is not listed, calculate as 50% of daily_rate
- All prices are in ZAR (South African Rand)
- Combine related items (e.g. "Camera Body + Kit Lens" = one item)
- Map categories carefully: microphones/recorders → "audio", LED panels/HMI → "lighting-power", dollies/gimbals → "grip-motion", drones → "aerial-support", PA/speakers/live sound → "sound-reinforcement"
- If a category doesn't fit, use "specialized-solutions"
- Extract brand and model separately from the title
- Tags should include the category name and any relevant keywords

Rate card text:
`;

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are accepted.' }, { status: 400 });
    }

    // Parse PDF → text using unpdf (works in all JS runtimes, no worker needed)
    const arrayBuffer = await file.arrayBuffer();
    const { extractText } = await import('unpdf');
    const { text: pdfPages, totalPages: pageCount } = await extractText(new Uint8Array(arrayBuffer));
    const pdfText = (Array.isArray(pdfPages) ? pdfPages.join('\n') : String(pdfPages ?? '')).trim();

    if (!pdfText || pdfText.length < 20) {
      return NextResponse.json(
        { error: 'Could not extract text from PDF. The file may be image-based or empty.' },
        { status: 422 },
      );
    }

    // Send to AI for structured extraction
    const model = getModel();
    const { text: aiResponse } = await generateText({
      model,
      prompt: EXTRACTION_PROMPT + pdfText,
      temperature: 0.1,
      maxOutputTokens: 8000,
    });

    // Parse AI response as JSON
    // Strip markdown fences if the model added them anyway
    let cleaned = aiResponse.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    let items: RateCardItem[];
    try {
      items = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: 'AI returned invalid JSON. Try re-uploading.', raw: cleaned },
        { status: 422 },
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'No items extracted from the rate card.', raw: cleaned },
        { status: 422 },
      );
    }

    // Validate and normalise each item
    const validCategories = [
      'cameras-optics', 'audio', 'lighting-power', 'grip-motion',
      'data-storage', 'crew-services', 'specialized-solutions',
      'aerial-support', 'sound-reinforcement',
    ];

    const normalised = items.map((item) => ({
      title: item.title || 'Untitled Item',
      category: validCategories.includes(item.category) ? item.category : 'specialized-solutions',
      sub_category: item.sub_category || null,
      brand: item.brand || null,
      model: item.model || null,
      description: item.description || null,
      features: Array.isArray(item.features) ? item.features : [],
      daily_rate: typeof item.daily_rate === 'number' ? item.daily_rate : 0,
      weekly_rate: typeof item.weekly_rate === 'number'
        ? item.weekly_rate
        : Math.round((item.daily_rate || 0) * 2.5),
      deposit: typeof item.deposit === 'number'
        ? item.deposit
        : Math.round((item.daily_rate || 0) * 0.5),
      tags: Array.isArray(item.tags) ? item.tags : [],
    }));

    return NextResponse.json({ items: normalised, pageCount });
  } catch (err) {
    console.error('[admin/import-ratecard] Error:', err);
    return NextResponse.json({ error: 'Failed to process rate card.' }, { status: 500 });
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────────

type RateCardItem = {
  title: string;
  category: string;
  sub_category?: string;
  brand?: string;
  model?: string;
  description?: string;
  features?: string[];
  daily_rate?: number;
  weekly_rate?: number;
  deposit?: number;
  tags?: string[];
};
