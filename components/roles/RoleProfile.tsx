import Link from 'next/link';
import { BadgeCheck, Briefcase, Mail, MapPin, ShieldCheck, User, Video } from 'lucide-react';
import { ROLES_POLICY, STUDIO } from '@/lib/constants';
import { formatRolePrice, jobsLine } from '@/lib/roles';
import type { PublicRoleProfile } from '@/lib/supabase/queries/roles';

/**
 * The one profile template every role uses. Hide the machinery: the work
 * shown large, one "Verified" mark, a real job count, one clear price and the
 * platform promise. Never the evidence level.
 */
export function RoleProfile({ profile }: { profile: PublicRoleProfile }) {
  const { personRole, role, person, work, verified, confirmedJobs } = profile;
  // The strongest picture first: never a "before" photo or a kit shot.
  const heroIndex = Math.max(0, work.findIndex((e) => e.kind === 'photo' && e.pair_side !== 'before' && e.step_key !== 'kit'));
  const hero = work[heroIndex];
  // Then before/after pairs side by side, the rest in order.
  const rest = work
    .filter((_, i) => i !== heroIndex)
    .sort((a, b) => (a.pair_group ?? '~').localeCompare(b.pair_group ?? '~') || (a.pair_side === 'before' ? -1 : b.pair_side === 'before' ? 1 : 0));
  const price = personRole.price_cents ?? role.suggested_price_cents.typical;

  return (
    <article className="pb-20">
      {/* The work, large */}
      <div className="relative w-full aspect-[4/5] sm:aspect-[16/9] max-h-[78vh] bg-neutral-900 overflow-hidden">
        {hero?.url && hero.kind === 'photo' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hero.url} alt={`Work by ${person.display_name}`} className="w-full h-full object-cover" />
        ) : hero?.url && hero.kind === 'video' ? (
          <video src={hero.url} className="w-full h-full object-cover" controls playsInline preload="metadata" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-600">
            <User className="w-16 h-16" aria-hidden="true" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0A0A0B] to-transparent" aria-hidden="true" />
      </div>

      <div className="max-w-3xl mx-auto px-4 -mt-16 relative">
        <p className="text-xs font-mono uppercase tracking-widest text-accent-gold mb-2">{role.name}</p>
        <h1 className="text-3xl sm:text-4xl font-display font-medium text-white mb-2">{person.display_name}</h1>
        {personRole.headline && <p className="text-lg text-neutral-300 mb-4">{personRole.headline}</p>}

        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm mb-6">
          {verified && (
            <li className="flex items-center gap-1.5 text-accent-gold" title={ROLES_POLICY.copy.verifiedHelp}>
              <BadgeCheck className="w-4 h-4" aria-hidden="true" /> {ROLES_POLICY.copy.verified}
            </li>
          )}
          <li className="flex items-center gap-1.5 text-neutral-300">
            <Briefcase className="w-4 h-4 text-neutral-500" aria-hidden="true" /> {jobsLine(confirmedJobs)}
          </li>
          {(personRole.area ?? person.location) && (
            <li className="flex items-center gap-1.5 text-neutral-400">
              <MapPin className="w-4 h-4 text-neutral-500" aria-hidden="true" /> {personRole.area ?? person.location}
            </li>
          )}
        </ul>

        <div className="border border-white/10 bg-white/[0.02] p-4 mb-8">
          <p className="text-2xl text-white font-display">{formatRolePrice(role.pricing_unit, price, personRole.per_km_cents)}</p>
          <p className="text-xs text-neutral-500 mt-1">The price you pay. Shown before you book.</p>
          <a
            href={`mailto:${STUDIO.bookingEmail}?subject=${encodeURIComponent(`Booking ${person.display_name} (${role.name})`)}`}
            className="mt-4 w-full min-h-[52px] px-6 bg-accent-gold text-black text-sm font-mono font-bold uppercase tracking-widest flex items-center justify-center gap-2"
          >
            <Mail className="w-4 h-4" aria-hidden="true" /> Ask to book
          </a>
          <p className="flex items-start gap-2 text-xs text-neutral-400 mt-4">
            <ShieldCheck className="w-4 h-4 text-accent-gold shrink-0" aria-hidden="true" /> {ROLES_POLICY.copy.promise}
          </p>
        </div>

        {personRole.about && <p className="text-neutral-300 leading-relaxed mb-8 whitespace-pre-line">{personRole.about}</p>}

        {rest.length > 0 && (
          <section aria-label="More work">
            <ul className="grid grid-cols-2 gap-2">
              {rest.map((e) => (
                <li key={e.id} className={`relative bg-neutral-900 overflow-hidden ${e.pair_side ? 'aspect-[3/4]' : 'aspect-square'}`}>
                  {e.kind === 'video' && e.url ? (
                    <div className="relative w-full h-full">
                      <video src={e.url} className="w-full h-full object-cover" controls playsInline preload="none" />
                      <Video className="absolute left-2 top-2 w-4 h-4 text-white" aria-hidden="true" />
                    </div>
                  ) : e.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : null}
                  {e.pair_side && (
                    <span className="absolute left-2 top-2 px-2 py-0.5 bg-black/70 text-[10px] font-mono uppercase text-white">{e.pair_side}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-10 text-sm text-neutral-500">
          <Link href={`/people?role=${role.slug}`} className="underline underline-offset-4 hover:text-white">
            See more people
          </Link>
        </p>
      </div>
    </article>
  );
}
