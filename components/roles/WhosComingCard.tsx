import { BadgeCheck, Calendar, Clock, Lock, MapPin, User } from 'lucide-react';
import type { WhosComing } from '@/lib/roles';

/**
 * Who, where, when (Uber style). The same card everywhere a person is booked.
 * Before a confirmed booking it is blind: the role, the record and the
 * label, never a face or a name (equal chance). After confirmation (reveal())
 * the client sees the face and first name; the person sees the address.
 */
export function WhosComingCard({ card, title = "Who's coming" }: { card: WhosComing; title?: string }) {
  const revealed = !!card.who.faceUrl || !!card.who.firstName;
  return (
    <section className="border border-white/15 bg-white/[0.03]" aria-label={title}>
      <p className="px-4 pt-4 text-xs font-mono uppercase tracking-widest text-neutral-400">{title}</p>

      {/* WHO */}
      <div className="flex items-center gap-4 p-4">
        <span className="relative w-16 h-16 shrink-0 rounded-full overflow-hidden bg-neutral-800 flex items-center justify-center">
          {card.who.faceUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.who.faceUrl} alt={card.who.firstName ? `${card.who.firstName}` : 'Their photo'} className="w-full h-full object-cover" />
          ) : (
            <User className="w-7 h-7 text-neutral-500" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-white text-lg">{card.who.firstName ?? card.who.roleName}</span>
          <span className="block text-xs text-neutral-400">{card.who.label}</span>
          <span className="flex flex-wrap items-center gap-x-3 text-xs mt-1">
            {card.who.verified && (
              <span className="flex items-center gap-1 text-accent-gold">
                <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> Verified
              </span>
            )}
            <span className="text-neutral-300">{card.who.record}</span>
          </span>
        </span>
      </div>
      {!revealed && (
        <p className="mx-4 mb-3 flex items-start gap-2 text-xs text-neutral-400">
          <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" /> Their photo and first name show here once the booking is paid and confirmed. Everyone is chosen for their work.
        </p>
      )}

      {/* WHERE and WHEN */}
      <dl className="grid grid-cols-1 gap-px bg-white/10 border-t border-white/10">
        <div className="bg-[#0A0A0B] p-4 flex items-start gap-3">
          <MapPin className="w-4 h-4 text-accent-gold mt-0.5" aria-hidden="true" />
          <div>
            <dt className="text-xs text-neutral-500">Where</dt>
            <dd className="text-white">{card.where.address ?? card.where.area}</dd>
            <dd className="text-xs text-neutral-500">{card.where.addressNote}</dd>
          </div>
        </div>
        <div className="bg-[#0A0A0B] p-4 flex items-start gap-3">
          <Calendar className="w-4 h-4 text-accent-gold mt-0.5" aria-hidden="true" />
          <div>
            <dt className="text-xs text-neutral-500">When</dt>
            <dd className="text-white">{card.when.date}</dd>
            <dd className="flex items-center gap-1 text-sm text-neutral-300">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" /> Arrives {card.when.arrival}
              {card.when.duration ? `, for ${card.when.duration}` : ''}
            </dd>
          </div>
        </div>
      </dl>
    </section>
  );
}
