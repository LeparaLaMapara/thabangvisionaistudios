import { STUDIO, RENTAL_POLICIES } from '@/lib/constants';

/**
 * The rental agreement the renter signs at handover (TASK-067), written from
 * the same settings as the Terms, so the two never disagree. Bump the version
 * whenever the wording changes; the signed version is stored with the booking.
 */
export const AGREEMENT_VERSION = '2026-09-28';

const rand = (n: number): string => `${STUDIO.currency.symbol}${Math.round(n).toLocaleString(STUDIO.currency.locale)}`;

export function handoverAgreement(params: {
  renterName: string;
  reference: string;
  startDate: string;
  endDate: string;
  items: { title: string; serial?: string | null }[];
  deposit: number;
}): string[] {
  const items = params.items.map((i) => `${i.title}${i.serial ? ` (serial ${i.serial})` : ''}`).join('; ');
  const fees = STUDIO.rental.protection.damageFees;
  return [
    `I, ${params.renterName}, am hiring the following from ${STUDIO.legal.companyName} (booking ${params.reference}): ${items}.`,
    `I will return everything by the end of ${params.endDate}, in the condition recorded in today's photos. Late returns cost ${rand(RENTAL_POLICIES.lateFeePerDayZar)} per item for each day or part of a day, taken from the deposit of ${rand(params.deposit)}.`,
    'The equipment stays the property of its owner. I will not lend, sub-hire, sell or pawn it, and I will keep it with me or under my control.',
    fees.published && fees.items.length > 0
      ? `Damage is charged at the published fees (${fees.items.map((f) => `${f.issue}: ${rand(f.fee)}`).join('; ')}), or the repair or replacement cost where no fee is listed.`
      : 'I am responsible for the repair or replacement cost of anything lost, stolen or damaged while in my care, as set out in section 13 of the Terms of Service.',
    'Keeping the equipment after the return date without agreement, or failing to return it, is theft. ThabangVision will report it to the South African Police Service with the serial numbers above and my verified identity.',
    `I have read and accept the Terms of Service at ${STUDIO.meta.url}/legal.`,
  ];
}
