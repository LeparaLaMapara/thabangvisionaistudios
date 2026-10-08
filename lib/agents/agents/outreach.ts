import type { UbunyeAgent } from '../types';
import { STUDIO } from '@/lib/constants';

export const outreachAgent: UbunyeAgent = {
  id: 'outreach',
  name: 'Ubunye Outreach',
  description: 'Drafts personalized outreach emails for wedding planners, event companies, and agencies',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  tools: [],
  rateLimit: { guest: 0, free: 0, pro: 0, studio: 0 },
  costTier: 'medium',
};

export interface OutreachInput {
  recipientName: string;
  recipientCompany: string;
  recipientRole: string;
  industry: string;
  servicesFit: string[];
  customContext?: string;
}

export interface OutreachOutput {
  subject: string;
  body: string;
  followUpSubject: string;
  followUpBody: string;
}

export function buildOutreachPrompt(input: OutreachInput): string {
  const services = input.servicesFit.join(', ');
  const area = STUDIO.serviceArea.province;

  return `You are drafting a B2B outreach email on behalf of ${STUDIO.name}, a ${STUDIO.location.city}-based marketplace to book photographers and videographers and hire camera gear in ${area}.

${STUDIO.name} offers (state only these facts; do not add others):
- Equipment rentals (cameras, lighting, audio, grip), collected in ${STUDIO.location.city}
- Photography and video shoots by request, with prices shown on each package page
- Ubunye, an AI assistant that answers questions and helps with quotes; prices are confirmed at checkout
- Creators who have passed an identity check
- We work in ${area}. ${STUDIO.serviceArea.outsideProvinceNote}

Do NOT claim: national coverage, an in-house production team, insurance, ratings, client numbers,
discounts, or any price that is not listed above.

RECIPIENT:
Name: ${input.recipientName}
Company: ${input.recipientCompany}
Role: ${input.recipientRole}
Industry: ${input.industry}
Services that fit: ${services}
${input.customContext ? `Context: ${input.customContext}` : ''}

Draft TWO emails:

**EMAIL 1 — INITIAL OUTREACH**
- Subject line (under 50 chars, curiosity-driven, no spam words)
- Body: 3-4 short paragraphs
  - Opening: reference their company/industry specifically (not generic)
  - Value: one concrete way ThabangVision solves a problem they likely have
  - Proof: mention only facts from the list above (for example, ID-checked creators or seeing the full price before booking)
  - CTA: suggest a specific next step (reply, book a call, visit the site)
- Sign off as ${STUDIO.name}

**EMAIL 2 — FOLLOW-UP (sent 5 days later if no reply)**
- Subject line (reference the first email naturally)
- Body: 2 short paragraphs, different angle, lighter tone
- Include a direct link: ${STUDIO.meta.url}/contact

Rules:
- South African English spelling
- Professional but human — not stiff, not salesy
- Never use "synergy", "leverage", "circle back", "touch base"
- Keep each email under 150 words
- Return labelled outputs: SUBJECT_1, BODY_1, SUBJECT_2, BODY_2`;
}
