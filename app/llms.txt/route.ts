import { STUDIO, PRODUCTION_CATEGORIES, RENTAL_CATEGORIES } from '@/lib/constants';

export function GET() {
  const baseUrl = STUDIO.meta.url;

  const categories = PRODUCTION_CATEGORIES.map(
    (c) => `- ${c.name}: ${c.description} Starting from R${c.startingRate}/${c.startingUnit}. ${baseUrl}/studio/category/${c.slug}`,
  ).join('\n');

  const rentals = RENTAL_CATEGORIES.map(
    (c) => `- ${c.label}: ${c.description} ${baseUrl}/rentals/${c.value}`,
  ).join('\n');

  const body = `# ${STUDIO.name}

> ${STUDIO.meta.description}

## About
${STUDIO.name} is a technology creative studio based in ${STUDIO.location.city}, ${STUDIO.location.country}. We provide production services and equipment rentals for filmmakers, photographers, and content creators across South Africa.

## Contact
- Email: ${STUDIO.email}
- Phone: ${STUDIO.phone}
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
- Smart Creators: ${baseUrl}/smart-creators
- Press: ${baseUrl}/press
- Careers: ${baseUrl}/careers
- About: ${baseUrl}/about
- Contact: ${baseUrl}/contact

## Pricing
Free to join and browse. You pay per booking: equipment at the rate shown on each
listing plus a refundable deposit, production services at the hourly rate quoted.
There is no subscription.

## How Orders Work
ThabangVision is the supplier and seller of record for every order. Customers pay
ThabangVision, not individual creators. Where a verified creator supplies the gear or
service, they are engaged as our supplier and we retain a 15% commission.

## Service Areas
We serve all major cities in South Africa including Johannesburg, Cape Town, Durban, Pretoria, Port Elizabeth, Bloemfontein, and more.
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
