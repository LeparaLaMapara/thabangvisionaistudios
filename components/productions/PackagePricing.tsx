'use client';

import { PRODUCTION_SERVICES } from '@/lib/constants';

type Package = {
  name: string;
  description: string;
  price: number | null;
  includes: string[];
  featured?: boolean;
};

const packages: Package[] = [
  {
    name: 'Headshot Session',
    description: '1-hour photography portrait session',
    price: PRODUCTION_SERVICES.photography.portrait.rate * 1,
    includes: [
      '1-hour studio session',
      '5 retouched images',
      'Online delivery',
    ],
  },
  {
    name: 'Content Creator Day',
    description: '4-hour lifestyle photography session',
    price: PRODUCTION_SERVICES.photography.lifestyle.rate * 4,
    includes: [
      '4-hour session',
      '20 edited images',
      'Social media formats',
    ],
  },
  {
    name: 'Wedding Film',
    description: '8-hour cinematic wedding coverage',
    price: PRODUCTION_SERVICES.cinematography.musicVideo.rate * 8,
    includes: [
      'Full-day coverage',
      'Cinematic edit',
      'Highlight reel',
    ],
  },
  {
    name: 'Music Video',
    description: '6-hour music video production',
    price: PRODUCTION_SERVICES.cinematography.musicVideo.rate * 6,
    includes: [
      'Multi-setup shoot',
      'Color grade',
      '2 revisions',
    ],
    featured: true,
  },
  {
    name: 'Corporate Package',
    description: '4-hour shoot + 2-hour post-production',
    price:
      PRODUCTION_SERVICES.cinematography.corporate.rate * 4 +
      PRODUCTION_SERVICES.postProduction.videoEdit.rate * 2,
    includes: [
      '2-camera setup',
      'Script support',
      'Edited deliverable',
    ],
  },
  {
    name: 'Custom Project',
    description: 'Tailored to your vision and budget',
    price: null,
    includes: [
      'Bespoke scope & timeline',
      'Dedicated project manager',
      'Flexible deliverables',
    ],
  },
];

function formatPrice(price: number): string {
  return price.toLocaleString('en-ZA');
}

export default function PackagePricing() {
  const vatRate = PRODUCTION_SERVICES.billing.vatRate;

  return (
    <section id="packages" className="py-24 bg-[#050505]">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <p className="text-[#D4A843] font-mono text-sm tracking-widest uppercase mb-3">
            Production Packages
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Transparent Pricing, No Surprises
          </h2>
          <p className="text-neutral-400 max-w-2xl mx-auto">
            Every package is calculated from our published hourly rates. Need
            something different? Request a custom quote below.
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {packages.map((pkg) => {
            const isCustom = pkg.price === null;
            const isFeatured = pkg.featured;

            return (
              <div
                key={pkg.name}
                className={`relative flex flex-col rounded-xl border p-6 transition-colors ${
                  isFeatured
                    ? 'border-[#D4A843] bg-[#D4A843]/5'
                    : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-700'
                }`}
              >
                {/* Popular badge */}
                {isFeatured && (
                  <span className="absolute -top-3 left-6 bg-[#D4A843] text-black text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                    Popular
                  </span>
                )}

                {/* Name & description */}
                <h3 className="text-lg font-semibold text-white mt-1">
                  {pkg.name}
                </h3>
                <p className="text-neutral-400 text-sm mt-1 mb-5">
                  {pkg.description}
                </p>

                {/* Price */}
                <div className="mb-5">
                  {isCustom ? (
                    <span className="text-2xl font-bold text-[#D4A843] font-mono">
                      Get Custom Quote
                    </span>
                  ) : (
                    <>
                      <span className="text-2xl font-bold text-white font-mono">
                        From R{formatPrice(pkg.price!)}
                      </span>
                      <span className="block text-neutral-500 text-xs mt-1">
                        excl. {vatRate}% VAT
                      </span>
                    </>
                  )}
                </div>

                {/* Includes */}
                <ul className="flex-1 space-y-2 mb-6">
                  {pkg.includes.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2 text-sm text-neutral-300"
                    >
                      <span className="text-[#D4A843] mt-0.5 shrink-0">
                        &#10003;
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                {isCustom ? (
                  <a
                    href="#brief-form"
                    className="block w-full text-center py-3 rounded-lg border border-[#D4A843] text-[#D4A843] font-semibold text-sm hover:bg-[#D4A843]/10 transition-colors"
                  >
                    Submit a Brief
                  </a>
                ) : (
                  <a
                    href="/contact"
                    className={`block w-full text-center py-3 rounded-lg font-semibold text-sm transition-colors ${
                      isFeatured
                        ? 'bg-[#D4A843] text-black hover:bg-[#c49a3a]'
                        : 'bg-neutral-800 text-white hover:bg-neutral-700'
                    }`}
                  >
                    Book This Package
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
