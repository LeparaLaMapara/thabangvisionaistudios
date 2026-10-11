import { STUDIO, PRODUCTION_CATEGORIES, RENTAL_CATEGORIES, RENTAL_POLICY, UBUNYE_STUDIO } from '@/lib/constants';
import { LISTED_CITIES } from '@/lib/seo/cities';

export function GET() {
  const baseUrl = STUDIO.meta.url;

  const categories = PRODUCTION_CATEGORIES.map(
    // No "starting from" figure: PRODUCTION_CATEGORIES.startingRate does not
    // match the real packages. Each category page shows its packages.
    (c) => `- ${c.name}: ${c.description} Packages and prices: ${baseUrl}/studio/category/${c.slug}`,
  ).join('\n');

  const rentals = RENTAL_CATEGORIES.map(
    (c) => `- ${c.label}: ${c.description} ${baseUrl}/rentals/${c.value}`,
  ).join('\n');

  const area = STUDIO.serviceArea.province;
  const cityPages = LISTED_CITIES.map((c) => c.name).join(', ');

  const body = `# ${STUDIO.name}

> ${STUDIO.meta.description}

## About
${STUDIO.name} is a technology creative studio based in ${STUDIO.location.city}, ${STUDIO.location.country}. We provide equipment rentals and production services by request for filmmakers, photographers and content creators in ${area}. ${STUDIO.serviceArea.outsideProvinceNote}

## Contact
- Email: ${STUDIO.email}
- WhatsApp (messages only): ${STUDIO.whatsapp.display}
- Bookings: ${STUDIO.bookingEmail}
- Website: ${baseUrl}

## Production Services
${categories}

## Equipment Rentals
${rentals}

## Key Pages
- Home: ${baseUrl}
- Studio (Production Services): ${baseUrl}/studio
- Equipment Rentals: ${baseUrl}/rentals
- Pricing: ${baseUrl}/pricing
- Ubunye AI Studio: ${baseUrl}/ubunye-ai-studio
- ${UBUNYE_STUDIO.suiteName} (free, open source creative tools, ${UBUNYE_STUDIO.statusLabels[UBUNYE_STUDIO.status].toLowerCase()}): ${baseUrl}/tools
- Smart Creators: ${baseUrl}/smart-creators
- Press: ${baseUrl}/press
- Careers: ${baseUrl}/careers
- About: ${baseUrl}/about
- Contact: ${baseUrl}/contact

## Pricing
Free to join and browse. You pay per booking: equipment at the rate shown on each
listing plus a refundable deposit, production services at the rate quoted.
Prices shown are final. There is no subscription.

## How Orders Work
ThabangVision is the supplier and seller of record for every order. Customers pay
ThabangVision, not individual creators. Where a verified creator supplies the gear or
service, they are engaged as our supplier and we retain a commission
(${RENTAL_POLICY.platformShareBps / 100}% of the hire fee on gear, ${STUDIO.creators.commissionRate}% on services).

## Service Areas
We work in ${area}. ${STUDIO.serviceArea.outsideProvinceNote}
Rental and studio pages exist for these ${area} cities (examples, not the whole province): ${cityPages}.
We reply ${STUDIO.responseTime}.
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
