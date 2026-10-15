import { NextRequest, NextResponse } from 'next/server';
import { aiBudgetResponse } from '@/lib/ai/budget-response';
import { isAiBudgetError } from '@/lib/ai/budget';
import { requireAuth, checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { analyzeScene, detectSkills } from '@/lib/agents/tools';
import type { SceneAnalysisResult } from '@/lib/agents/types';
import { isOwnImageUrl } from '@/app/api/listings/_lib/images';
import { STUDIO } from '@/lib/constants';

// ─── POST /api/agents/portfolios ────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    const { user } = auth;

    const suspension = await checkNotSuspended(user.id);
    if (suspension.suspended) {
      return NextResponse.json(
        { error: `Account suspended: ${suspension.reason ?? 'Contact support.'}` },
        { status: 403 },
      );
    }

    // Rate limit: 50 requests per day per user
    if (!(await checkRateLimit(`agents:portfolios:${user.id}`, 50, 86_400_000))) {
      return NextResponse.json(
        { error: 'Daily limit reached. Try again tomorrow.' },
        { status: 429 },
      );
    }

    const body = await req.json();
    const { action } = body as { action: string };

    if (!action) {
      return NextResponse.json({ error: 'Missing required field: action' }, { status: 400 });
    }

    switch (action) {
      case 'analyze-portfolio': {
        const { imageUrls } = body as { imageUrls?: string[] };

        if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
          return NextResponse.json(
            { error: 'imageUrls must be a non-empty array.' },
            { status: 400 },
          );
        }

        if (imageUrls.length > STUDIO.security.portfolioAnalyzeMaxImages) {
          return NextResponse.json(
            { error: `Analyze at most ${STUDIO.security.portfolioAnalyzeMaxImages} photos at a time.` },
            { status: 400 },
          );
        }

        // The server fetches each image, so only photos uploaded to our own
        // storage account are accepted (https, our cloud, /image/upload/).
        // Anything else let any signed-in user make the server request
        // internal addresses (security INJ-2). The fetch itself is also
        // guarded (lib/security/safe-fetch.ts).
        for (const url of imageUrls) {
          if (typeof url !== 'string' || !isOwnImageUrl(url)) {
            return NextResponse.json(
              { error: 'Upload the photos first, then try again.' },
              { status: 400 },
            );
          }
        }

        const supabase = await createClient();
        const results: SceneAnalysisResult[] = [];

        // Process each image sequentially to avoid rate limits
        for (const imageUrl of imageUrls) {
          try {
            const analysis = await analyzeScene(imageUrl, user.id);
            results.push(analysis);

            // Save to portfolio_analysis table
            await supabase.from('portfolio_analysis').insert({
              creator_id: user.id,
              photo_url: imageUrl,
              scene_type: analysis.sceneType,
              lighting_setup: analysis.lightingSetup,
              quality_score: analysis.qualityScore,
              description: analysis.description,
              hashtags: analysis.hashtags,
            });
          } catch (analyzeErr) {
            if (isAiBudgetError(analyzeErr)) throw analyzeErr;
            console.error(`[analyze-portfolio] Failed for ${imageUrl}:`, analyzeErr);
            // Push a fallback result so the client knows which one failed
            results.push({
              sceneType: 'other',
              lightingSetup: 'unknown',
              qualityScore: 0,
              description: 'Analysis failed for this image.',
              hashtags: [],
            });
          }
        }

        return NextResponse.json({ success: true, data: results });
      }

      case 'detect-skills': {
        const { analyses } = body as { analyses?: SceneAnalysisResult[] };

        if (!analyses || !Array.isArray(analyses) || analyses.length === 0) {
          return NextResponse.json(
            { error: 'analyses must be a non-empty array.' },
            { status: 400 },
          );
        }

        const result = await detectSkills(analyses);
        return NextResponse.json({ success: true, data: result });
      }

      case 'correct-tag': {
        const { photoUrl, originalTag, correctedTag } = body as {
          photoUrl?: string;
          originalTag?: string;
          correctedTag?: string;
        };

        if (!photoUrl || !originalTag || !correctedTag) {
          return NextResponse.json(
            { error: 'photoUrl, originalTag, and correctedTag are required.' },
            { status: 400 },
          );
        }
        if (originalTag === correctedTag) {
          return NextResponse.json({ success: true, skipped: true });
        }

        const adminClient = createAdminClient();

        // Log the correction for future prompt tuning.
        await adminClient.from('portfolio_tag_corrections').insert({
          creator_id: user.id,
          photo_url: photoUrl,
          original_tag: originalTag,
          corrected_tag: correctedTag,
        });

        // Update the stored analysis so downstream skill detection uses the fix.
        await adminClient
          .from('portfolio_analysis')
          .update({ scene_type: correctedTag })
          .eq('creator_id', user.id)
          .eq('photo_url', photoUrl);

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Use 'analyze-portfolio', 'detect-skills', or 'correct-tag'.` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error('[POST /api/agents/portfolios]', err);
    const budgetRes = aiBudgetResponse(err);
    if (budgetRes) return budgetRes;
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
