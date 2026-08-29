export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { trackedCompletion } from '@/lib/ai/tracked';
import { getModel } from '@/lib/ai';
import { generateText } from 'ai';
import {
  buildOutreachPrompt,
  type OutreachInput,
} from '@/lib/agents/agents/outreach';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();

    const { recipientName, recipientCompany, recipientRole, industry, servicesFit, customContext } = body;

    if (!recipientName || !recipientCompany || !recipientRole || !industry) {
      return NextResponse.json(
        { error: 'recipientName, recipientCompany, recipientRole, and industry are required' },
        { status: 400 },
      );
    }

    const input: OutreachInput = {
      recipientName,
      recipientCompany,
      recipientRole,
      industry,
      servicesFit: Array.isArray(servicesFit) ? servicesFit : ['Photography', 'Video Production'],
      customContext,
    };

    const prompt = buildOutreachPrompt(input);
    const model = getModel();

    const result = await trackedCompletion({
      agentId: 'outreach',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
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

    return NextResponse.json({ emails: result, recipient: recipientCompany });
  } catch (err) {
    console.error('[outreach-draft]', err);
    return NextResponse.json({ error: 'Failed to generate outreach emails' }, { status: 500 });
  }
}
