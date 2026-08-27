export const dynamic = 'force-dynamic';
export const maxDuration = 45;

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { trackedCompletion } from '@/lib/ai/tracked';
import {
  productionDescriberAgent,
  buildVisionPrompt,
  buildDescriptionPrompt,
  parseVisionOutput,
  parseDescriptionOutput,
  type ProductionDescriberInput,
  type ProductionDescriberOutput,
  type VisionAnalysis,
} from '@/lib/agents/agents/production-describer';

const GEMMA_MODEL = 'gemma-4-31b-it';

async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const limited = await rateLimitAdmin(auth.user.id);
  if (limited) return limited;

  try {
    const body = await req.json();
    const { title, projectType, imageUrl, subCategory, client, year } =
      body as Partial<ProductionDescriberInput>;

    if (!title || !projectType || !imageUrl) {
      return NextResponse.json(
        { error: 'title, projectType, and imageUrl are required.' },
        { status: 400 },
      );
    }

    const input: ProductionDescriberInput = {
      title: title.trim(),
      projectType: projectType.trim(),
      imageUrl: imageUrl.trim(),
      subCategory: subCategory?.trim() ?? null,
      client: client?.trim() ?? null,
      year: year ?? null,
    };

    // Step 1: Gemma Vision analyzes the cover image
    const imageData = await fetchImageAsBase64(input.imageUrl);

    const vision = await trackedCompletion<VisionAnalysis>({
      agentId: 'production-describer:vision',
      provider: 'google',
      model: GEMMA_MODEL,
      userId: auth.user.id,
      call: async () => {
        const gemma = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        const model = gemma.getGenerativeModel({ model: GEMMA_MODEL });

        const result = await model.generateContent([
          { inlineData: { mimeType: 'image/jpeg', data: imageData } },
          buildVisionPrompt(),
        ]);

        const text = result.response.text().trim();
        return {
          result: parseVisionOutput(text),
          usage: {
            inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
            outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
          },
        };
      },
    });

    // Step 2: Claude writes the description + tags using the vision analysis
    const output = await trackedCompletion<ProductionDescriberOutput>({
      agentId: productionDescriberAgent.id,
      provider: 'anthropic',
      model: productionDescriberAgent.model,
      userId: auth.user.id,
      call: async () => {
        const res = await generateText({
          model: anthropic(productionDescriberAgent.model),
          prompt: buildDescriptionPrompt(input, vision),
          temperature: 0.6,
        });
        return {
          result: parseDescriptionOutput(res.text),
          usage: {
            inputTokens: res.usage.inputTokens ?? 0,
            outputTokens: res.usage.outputTokens ?? 0,
          },
        };
      },
    });

    return NextResponse.json({ vision, ...output });
  } catch (err) {
    console.error('[agents/production-describer] error:', err);
    return NextResponse.json(
      { error: 'Failed to generate production description. Please try again.' },
      { status: 500 },
    );
  }
}
