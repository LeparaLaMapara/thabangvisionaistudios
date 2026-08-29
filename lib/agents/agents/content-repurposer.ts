import type { UbunyeAgent } from '../types';

export const contentRepurposerAgent: UbunyeAgent = {
  id: 'content-repurposer',
  name: 'Ubunye Content Repurposer',
  description: 'Transforms press articles into social media posts, email snippets, and SEO variants',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  tools: [],
  rateLimit: { guest: 0, free: 0, pro: 0, studio: 0 },
  costTier: 'medium',
};

export interface ContentRepurposerInput {
  title: string;
  content: string;
  excerpt: string | null;
  category: string | null;
  author: string | null;
  articleUrl: string;
}

export interface RepurposedContent {
  twitterPost: string;
  instagramCaption: string;
  linkedinPost: string;
  emailSnippet: { subject: string; body: string };
  seoTitle: string;
  seoDescription: string;
}

export function buildContentRepurposerPrompt(input: ContentRepurposerInput): string {
  return `You are a social media strategist for ThabangVision AI Studios, a creative production platform in South Africa.

Given this press article, generate platform-specific social content:

ARTICLE:
Title: ${input.title}
Category: ${input.category ?? 'General'}
Author: ${input.author ?? 'ThabangVision'}
Excerpt: ${input.excerpt ?? ''}
Full content:
${input.content}

URL: ${input.articleUrl}

Generate the following, each clearly labelled:

1. **TWITTER** (max 280 chars, include the article URL, no hashtags at end — weave them naturally or skip)
2. **INSTAGRAM** (caption for a feed post, 2-3 sentences, line breaks for readability, max 5 hashtags at end, South African tone)
3. **LINKEDIN** (professional post, 3-4 sentences, end with a CTA to read the article)
4. **EMAIL** (subject line + 2-sentence body for a newsletter mention, include the URL)
5. **SEO_TITLE** (under 60 chars, optimised for Google)
6. **SEO_DESCRIPTION** (under 155 chars, includes a call to action)

Rules:
- Use South African English spelling (colour, organisation, programme)
- Reference South Africa, Johannesburg, or the local creative industry where natural
- Keep the tone confident and modern — not corporate, not try-hard
- Never use "passionate", "innovative", or "cutting-edge"
- Each piece should stand alone — don't reference other platforms

Return ONLY the labelled outputs, no preamble.`;
}
