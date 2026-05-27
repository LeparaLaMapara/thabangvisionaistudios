export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getPressBySlug } from '@/lib/supabase/queries/press';
import { trackedCompletion } from '@/lib/ai/tracked';
import { getModel } from '@/lib/ai';
import { generateText } from 'ai';
import { STUDIO } from '@/lib/constants';
import {
  buildContentRepurposerPrompt,
  type ContentRepurposerInput,
} from '@/lib/agents/agents/content-repurposer';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const { slug } = await req.json();

    if (!slug || typeof slug !== 'string') {
      return NextResponse.json({ error: 'slug is required' }, { status: 400 });
    }

    const article = await getPressBySlug(slug);
    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    if (!article.content) {
      return NextResponse.json({ error: 'Article has no content to repurpose' }, { status: 400 });
    }

    const input: ContentRepurposerInput = {
      title: article.title,
      content: article.content,
      excerpt: article.excerpt,
      category: article.category,
      author: article.author,
      articleUrl: `${STUDIO.meta.url}/press/${article.slug}`,
    };

    const prompt = buildContentRepurposerPrompt(input);
    const model = getModel();

    const result = await trackedCompletion({
      agentId: 'content-repurposer',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      userId: auth.user.id,
      call: async () => {
        const response = await generateText({ model, prompt });
        return {
          result: response.text,
          usage: {
            inputTokens: response.usage?.inputTokens ?? 0,
            outputTokens: response.usage?.outputTokens ?? 0,
          },
        };
      },
    });

    return NextResponse.json({ content: result, article: article.title });
  } catch (err) {
    console.error('[content-repurpose]', err);
    return NextResponse.json({ error: 'Failed to generate content' }, { status: 500 });
  }
}
