import { GoogleGenerativeAI } from '@google/generative-ai';
import { trackedCompletion } from '@/lib/ai/tracked';
import type { SceneAnalysisResult, SkillDetectionResult } from '../types';

const MODEL_ID = 'gemma-4-31b-it';
const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = client.getGenerativeModel({ model: MODEL_ID });

async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

export async function analyzeScene(
  imageUrl: string,
  userId?: string | null,
): Promise<SceneAnalysisResult> {
  const imageData = await fetchImageAsBase64(imageUrl);

  return trackedCompletion<SceneAnalysisResult>({
    agentId: 'portfolios:analyze-scene',
    provider: 'google',
    model: MODEL_ID,
    userId,
    call: async () => {
      const result = await model.generateContent([
        { inlineData: { mimeType: 'image/jpeg', data: imageData } },
        `Analyze this portfolio photograph. Return ONLY valid JSON with:
         - sceneType: string (wedding, portrait, corporate, product, event, landscape, fashion, food, real_estate, other)
         - lightingSetup: string (natural, studio, softbox, ring_light, mixed, golden_hour, flash, ambient)
         - qualityScore: number 0-100
         - description: string (a professional 1-sentence caption)
         - hashtags: string[] (5-8 relevant hashtags without the # symbol)

         Return ONLY the JSON object, no markdown, no explanation.`,
      ]);

      const text = result.response.text().trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Failed to parse scene analysis response');

      return {
        result: JSON.parse(jsonMatch[0]) as SceneAnalysisResult,
        usage: {
          inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    },
  });
}

export async function detectSkills(
  analyses: SceneAnalysisResult[]
): Promise<SkillDetectionResult> {
  const sceneCounts: Record<string, number> = {};
  for (const a of analyses) {
    const scene = a.sceneType.toLowerCase();
    sceneCounts[scene] = (sceneCounts[scene] || 0) + 1;
  }

  const total = analyses.length;
  const skills = Object.entries(sceneCounts)
    .map(([name, count]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
      percentage: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.percentage - a.percentage);

  return { skills };
}
