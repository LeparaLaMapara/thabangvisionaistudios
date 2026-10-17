'use client';

import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { PersonCardBody } from '@/components/roles/PersonCard';

/**
 * find_people results in the chat (lib/agents/tools/people.ts): the same
 * blind cards as /people, in one row the client swipes through, each with
 * "Request this person" (the request form,
 * prefilled), the honest availability line and, at short notice, WhatsApp.
 * The output is the server tool's, never model text; it is still checked
 * here so only our own paths and our WhatsApp link become links.
 */

interface Match {
  id: string;
  role: string;
  area: string;
  area_fit: string;
  profile_url: string;
  request_url: string;
  price: string;
  total: string;
  total_label: string;
  cover_url: string | null;
  verified: boolean;
  record: string;
  usual_days_note: string | null;
  budget_note: string | null;
  plan_request_url: string | null;
}

const UUID = /^[0-9a-f-]{36}$/i;
const DEMO_SAMPLES = '/roles/demo/';
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const isWhatsapp = (v: unknown): v is string => typeof v === 'string' && v.startsWith('https://wa.me/');
const isOwnPath = (v: unknown): v is string => typeof v === 'string' && v.startsWith('/') && !v.startsWith('//');

function toMatch(raw: unknown): Match | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const id = str(m.id);
  if (!UUID.test(id)) return null;
  const request = str(m.request_url);
  if (!request.startsWith(`/people/${id}/request`)) return null;
  const cover = str(m.cover_url);
  const planLink = str(m.plan_request_url);
  return {
    id,
    role: str(m.role),
    area: str(m.area),
    area_fit: str(m.area_fit),
    profile_url: `/people/${id}`,
    request_url: request,
    price: str(m.price),
    total: str(m.total),
    total_label: str(m.total_label),
    // A demo sample picture (public/roles/demo, it says SAMPLE) is not a real
    // photo of their work: the card shows the plain role tile instead.
    cover_url: cover && !cover.startsWith(DEMO_SAMPLES) && (cover.startsWith('https://') || isOwnPath(cover)) ? cover : null,
    verified: m.verified === true,
    record: str(m.record),
    usual_days_note: str(m.usual_days_note) || null,
    budget_note: str(m.budget_note) || null,
    plan_request_url: planLink.startsWith(`/people/${id}/request?`) && /[?&]plan=[0-9a-f-]{36}(&|$)/i.test(planLink) ? planLink : null,
  };
}

const button = 'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 text-xs font-mono font-bold uppercase tracking-widest transition-opacity hover:opacity-80';

function WhatsappButton({ href, label = 'WhatsApp us' }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${button} border border-[#D4A843]/50 text-[#D4A843]`}>
      <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" /> {label}
    </a>
  );
}

export function PeopleResults({ output }: { output: unknown }) {
  if (!output || typeof output !== 'object') return null;
  const o = output as Record<string, unknown>;

  if (o.kind === 'people_unavailable') {
    const wa = isWhatsapp(o.whatsapp_url) ? o.whatsapp_url : null;
    const browse = isOwnPath(o.browse_url) ? o.browse_url : null;
    if (!wa && !browse) return null;
    return (
      <div className="flex flex-wrap gap-2 pt-2">
        {wa && <WhatsappButton href={wa} />}
        {browse && <Link href={browse} className={`${button} border border-white/15 text-neutral-200`}>See People</Link>}
      </div>
    );
  }
  if (o.kind !== 'people_results') return null;

  const matches = (Array.isArray(o.matches) ? o.matches : []).map(toMatch).filter((m): m is Match => m !== null);
  const date = o.date && typeof o.date === 'object' ? str((o.date as Record<string, unknown>).label) : '';
  const short = o.short_notice && typeof o.short_notice === 'object' ? (o.short_notice as Record<string, unknown>) : null;
  const wa = isWhatsapp(o.whatsapp_url) ? o.whatsapp_url : null;
  const browse = isOwnPath(o.browse_url) ? o.browse_url : '/people';

  return (
    <section aria-label="People who match" className="pt-3 space-y-3">
      {matches.length > 0 && (
        // One row the client swipes through, not a tall stack under the reply.
        <ul className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 scrollbar-thin scrollbar-thumb-neutral-800 scrollbar-track-transparent">
          {matches.map((m) => (
            <li key={m.id} className="snap-start shrink-0 w-[78%] max-w-[300px] sm:w-[260px] rounded-2xl overflow-hidden border border-white/10 bg-[#0b0b0b] flex flex-col">
              <Link href={m.profile_url} className="block hover:opacity-90">
                <PersonCardBody
                  compact
                  card={{ label: m.area ? `${m.role} in ${m.area}` : m.role, roleName: m.role, cover: m.cover_url, verified: m.verified, record: m.record, priceText: m.price }}
                />
              </Link>
              <div className="px-4 pb-4 space-y-1 text-xs text-neutral-400 mt-auto">
                {m.area_fit && <p>{m.area_fit}</p>}
                {m.total && (
                  <p className="text-neutral-200">
                    {date ? `${date}: ` : ''}Total {m.total}
                    {m.total_label && <span className="text-neutral-500"> ({m.total_label})</span>}
                  </p>
                )}
                {m.budget_note && <p>{m.budget_note}</p>}
                {m.usual_days_note && <p className="text-amber-200/80">{m.usual_days_note}</p>}
                <Link href={m.request_url} className={`${button} w-full mt-2 bg-[#D4A843] text-black`}>
                  Request this person
                </Link>
                {m.plan_request_url && (
                  <Link href={m.plan_request_url} className={`${button} w-full border border-[#D4A843]/50 text-[#D4A843]`}>
                    Add to my plan
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {typeof o.availability === 'string' && matches.length > 0 && <p className="text-xs text-neutral-400">{o.availability}</p>}
      {short && typeof short.message === 'string' && (
        <div className="border border-amber-300/30 bg-amber-300/5 p-3 space-y-2" role="note">
          <p className="text-sm text-amber-100/90">{short.message}</p>
          {isWhatsapp(short.whatsapp_url) && <WhatsappButton href={short.whatsapp_url} label="WhatsApp us now" />}
        </div>
      )}
      {matches.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {wa && !short && <WhatsappButton href={wa} />}
          <Link href={browse} className={`${button} border border-white/15 text-neutral-200`}>See People</Link>
        </div>
      )}
    </section>
  );
}
