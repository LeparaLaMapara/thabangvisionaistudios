import { BadgeCheck, Package } from 'lucide-react';
import { ROLES_POLICY } from '@/lib/constants';

/**
 * One blind People card (equal chance): a work photo, the role and area, a
 * record line and the price. Never a face or a name. Shared by /people and
 * Ubunye's find_people results, so the chat shows what the page shows.
 * The caller wraps it in a link (the page) or adds actions below it (chat).
 */
export interface PersonCardData {
  label: string;
  roleName: string;
  cover: string | null;
  verified: boolean;
  record: string;
  priceText: string | null;
  headline?: string | null;
  comesWith?: string | null;
}

export function PersonCardBody({ card }: { card: PersonCardData }) {
  return (
    <>
      <div className="aspect-[4/3] bg-neutral-900 overflow-hidden flex items-center justify-center">
        {card.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.cover} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span className="text-neutral-600 text-sm">{card.roleName}</span>
        )}
      </div>
      <div className="p-4">
        <p className="text-white flex items-center gap-2">
          {card.label}
          {card.verified && <BadgeCheck className="w-4 h-4 text-accent-gold shrink-0" aria-label={ROLES_POLICY.copy.verified} />}
        </p>
        {card.headline && <p className="text-sm text-neutral-400 line-clamp-1">{card.headline}</p>}
        {card.comesWith && <p className="flex items-center gap-1 text-xs text-neutral-300 mt-1"><Package className="w-3.5 h-3.5 text-accent-gold" aria-hidden="true" /> Comes with: {card.comesWith}</p>}
        <p className="text-xs text-neutral-500 mt-2">{card.record}</p>
        {card.priceText && <p className="text-sm text-neutral-200 mt-1">{card.priceText}</p>}
      </div>
    </>
  );
}
