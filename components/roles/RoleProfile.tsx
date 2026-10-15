import Link from 'next/link';
import { BadgeCheck, Briefcase, CalendarPlus, MapPin, Package, ShieldCheck, Star } from 'lucide-react';
import { ROLES_POLICY } from '@/lib/constants';
import { earningsLine, effectiveUnit, factsSummary, formatRolePrice, groupAlbums, selfieIsProof } from '@/lib/roles';
import { AlbumGallery } from './AlbumGallery';
import type { PublicRoleProfile } from '@/lib/supabase/queries/roles';
import type { RoleEvidence } from '@/lib/roles';
import { WhosComingCard } from './WhosComingCard';

/**
 * The one profile template, BLIND (equal chance): no face and no name before
 * a confirmed booking. Three things for the client: the work (or the facts
 * for trust roles), the price, and one record line. Plus "comes with" and
 * work-only reviews with initials. Proof shows by the role's format:
 *   look   photo grid (models: their digitals ARE the work, the one exception)
 *   listen audio players
 *   thing  guided item photos
 *   trust  facts and the record first, supporting photos second
 */

function Media({ e, large = false }: { e: RoleEvidence; large?: boolean }) {
  if (e.media_kind === 'audio') {
    return <audio src={e.url ?? undefined} controls preload="none" className="w-full" />;
  }
  if (e.kind === 'video') {
    return <video src={e.url ?? undefined} className="w-full h-full object-cover" controls playsInline preload="none" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={e.url ?? ''} alt="" className="w-full h-full object-cover" loading={large ? 'eager' : 'lazy'} />;
}

export function RoleProfile({ profile, preview = false }: { profile: PublicRoleProfile; preview?: boolean }) {
  const { personRole, role, label, work, facts, comesWith, verified, record, reviews } = profile;
  const price = personRole.price_cents ?? role.suggested_price_cents.typical;
  const format = role.proof_format;
  const audio = work.filter((e) => e.media_kind === 'audio');
  const visual = work.filter((e) => e.media_kind !== 'audio' && !(comesWith?.evidenceIds.includes(e.id)));
  // A portfolio with albums (092) is one gallery with album tabs.
  const albums = visual.some((e) => e.album) ? groupAlbums(visual) : null;
  const hero = albums || format === 'trust' || format === 'listen' ? null : visual.find((e) => e.kind === 'photo') ?? null;
  const rest = albums ? [] : visual.filter((e) => e !== hero);
  const unit = effectiveUnit(role.pricing_unit, personRole.pricing_unit);
  const summary = factsSummary(facts);

  return (
    <article className="pb-20">
      {hero && (
        <div className="relative w-full aspect-[4/5] sm:aspect-[16/9] max-h-[70vh] bg-neutral-900 overflow-hidden">
          <Media e={hero} large />
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#0A0A0B] to-transparent" aria-hidden="true" />
        </div>
      )}

      <div className={`max-w-3xl mx-auto px-4 relative ${hero ? '-mt-12' : 'pt-8'}`}>
        <h1 className="text-3xl font-display font-medium text-white mb-1">{label}</h1>
        {personRole.headline && <p className="text-lg text-neutral-300 mb-3">{personRole.headline}</p>}

        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm mb-6">
          {verified && (
            <li className="flex items-center gap-1.5 text-accent-gold" title={ROLES_POLICY.copy.verifiedHelp}>
              <BadgeCheck className="w-4 h-4" aria-hidden="true" /> {ROLES_POLICY.copy.verified}
            </li>
          )}
          <li className="flex items-center gap-1.5 text-neutral-200">
            <Briefcase className="w-4 h-4 text-neutral-500" aria-hidden="true" /> {record.line}
          </li>
          {personRole.area && (
            <li className="flex items-center gap-1.5 text-neutral-400">
              <MapPin className="w-4 h-4 text-neutral-500" aria-hidden="true" /> {personRole.area}
            </li>
          )}
        </ul>

        {albums && <AlbumGallery albums={albums} />}

        {/* Trust roles: the facts and the record ARE the proof. */}
        {format === 'trust' && summary.length > 0 && (
          <section className="mb-6 border border-white/10 p-4" aria-label="Facts">
            <ul className="space-y-1.5 text-sm text-neutral-200">
              {summary.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </section>
        )}

        {comesWith && (
          <section className="mb-6 border border-white/10 p-4" aria-label="Comes with">
            <p className="flex items-center gap-2 text-white"><Package className="w-4 h-4 text-accent-gold" aria-hidden="true" /> Comes with: {comesWith.label}</p>
            {comesWith.photos.length > 0 && (
              <ul className="grid grid-cols-3 gap-2 mt-3">
                {comesWith.photos.map((e) => (
                  <li key={e.id} className="aspect-square bg-neutral-900 overflow-hidden"><Media e={e} /></li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="border border-white/10 bg-white/[0.02] p-4 mb-6">
          <p className="text-2xl text-white font-display">{formatRolePrice(unit, price, personRole.per_km_cents)}</p>
          <p className="text-xs text-neutral-500 mt-1">{preview ? earningsLine(unit, price) : 'The price you pay. Shown before you book.'}</p>
          {preview ? (
            <p className="mt-4 text-sm text-neutral-400">Clients see a &ldquo;Request a booking&rdquo; button here.</p>
          ) : (
            <Link href={`/people/${personRole.id}/request`} className="mt-4 w-full min-h-[52px] px-6 bg-accent-gold text-black text-sm font-mono font-bold uppercase tracking-widest flex items-center justify-center gap-2">
              <CalendarPlus className="w-4 h-4" aria-hidden="true" /> Request a booking
            </Link>
          )}
          <p className="flex items-start gap-2 text-xs text-neutral-400 mt-4">
            <ShieldCheck className="w-4 h-4 text-accent-gold shrink-0" aria-hidden="true" /> {ROLES_POLICY.copy.promise}
          </p>
        </div>

        {format === 'listen' && audio.length > 0 && (
          <section className="mb-6 space-y-3" aria-label="Listen">
            {audio.map((e) => <div key={e.id} className="border border-white/10 p-3"><Media e={e} /></div>)}
          </section>
        )}

        {rest.length > 0 && (
          <section className="mb-6" aria-label={format === 'thing' || format === 'trust' ? 'Photos' : 'Work'}>
            {selfieIsProof(role.slug) && <p className="text-xs text-neutral-500 mb-2">For models, how they look is the work.</p>}
            <ul className="grid grid-cols-2 gap-2">
              {rest.map((e) => <li key={e.id} className="aspect-square bg-neutral-900 overflow-hidden"><Media e={e} /></li>)}
            </ul>
          </section>
        )}

        {format !== 'trust' && summary.length > 0 && (
          <section className="mb-6" aria-label="About the work">
            <ul className="space-y-1 text-sm text-neutral-300">{summary.map((l) => <li key={l}>{l}</li>)}</ul>
          </section>
        )}
        {personRole.about && <p className="text-neutral-300 leading-relaxed mb-6 whitespace-pre-line">{personRole.about}</p>}

        {reviews.length > 0 && (
          <section className="mb-6" aria-label="Reviews">
            <ul className="space-y-3">
              {reviews.map((r, i) => (
                <li key={i} className="border-l-2 border-accent-gold/50 pl-3">
                  <p className="flex items-center gap-1 text-sm text-white"><Star className="w-3.5 h-3.5 text-accent-gold" aria-hidden="true" /> {r.rating}/5 {r.initials && <span className="text-neutral-500">· {r.initials}</span>}</p>
                  {r.comment && <p className="text-sm text-neutral-300">{r.comment}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {!preview && (
          <WhosComingCard
            title="This is who will arrive"
            card={{
              status: 'requested',
              who: { label, roleName: role.name, verified, record: record.line, firstName: null, faceUrl: null },
              where: { area: personRole.area ?? 'Your area', address: null, addressNote: 'Your address is shared with them only after the booking is confirmed.' },
              when: { date: 'The date you choose', arrival: 'the time you choose', duration: '' },
            }}
          />
        )}
        <p className="mt-4 text-xs text-neutral-500">{ROLES_POLICY.copy.blindNote}</p>
      </div>
    </article>
  );
}
