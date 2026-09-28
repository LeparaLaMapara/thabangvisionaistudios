'use client';

import { PRODUCTION_PACKAGES, PRODUCTION_SERVICES, PRODUCTION_CATEGORIES } from '@/lib/constants';
import { calculatePackagePrice, formatZAR } from '@/lib/productions/pricing';
import { useState } from 'react';

export default function PackagePricing() {
  const vatRate = PRODUCTION_SERVICES.billing.vatRate;
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filteredPackages = activeCategory
    ? PRODUCTION_PACKAGES.filter((pkg) => pkg.category === activeCategory)
    : PRODUCTION_PACKAGES;

  return (
    <section id="packages" className="py-24 bg-[#050505]">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-10">
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

        {/* Category filter tabs */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          <button
            onClick={() => setActiveCategory(null)}
            className={`px-4 py-2 text-xs font-mono uppercase tracking-wider transition-colors ${
              activeCategory === null
                ? 'bg-[#D4A843] text-black'
                : 'bg-neutral-900 text-neutral-400 hover:text-white border border-white/10'
            }`}
          >
            All
          </button>
          {PRODUCTION_CATEGORIES.map((cat) => {
            const hasPackages = PRODUCTION_PACKAGES.some((p) => p.category === cat.slug);
            if (!hasPackages) return null;
            return (
              <button
                key={cat.slug}
                onClick={() => setActiveCategory(cat.slug)}
                className={`px-4 py-2 text-xs font-mono uppercase tracking-wider transition-colors ${
                  activeCategory === cat.slug
                    ? 'bg-[#D4A843] text-black'
                    : 'bg-neutral-900 text-neutral-400 hover:text-white border border-white/10'
                }`}
              >
                {cat.name}
              </button>
            );
          })}
        </div>

        {/* Package grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPackages.map((pkg) => {
            const price = calculatePackagePrice(pkg);
            const isFeatured = pkg.popular;
            const category = PRODUCTION_CATEGORIES.find((c) => c.slug === pkg.category);

            return (
              <div
                key={pkg.id}
                className={`relative flex flex-col rounded-xl border p-6 transition-colors ${
                  isFeatured
                    ? 'border-[#D4A843] bg-[#D4A843]/5'
                    : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-700'
                }`}
              >
                {isFeatured && (
                  <span className="absolute -top-3 left-6 bg-[#D4A843] text-black text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                    Most Popular
                  </span>
                )}

                {category && (
                  <span className="text-[10px] font-mono text-[#D4A843]/70 uppercase tracking-widest mb-1">
                    {category.name}
                  </span>
                )}

                <h3 className="text-lg font-semibold text-white">
                  {pkg.name}
                </h3>
                <p className="text-neutral-400 text-sm mt-1 mb-5">
                  {pkg.description}
                </p>

                {/* Price */}
                <div className="mb-5">
                  <span className="text-2xl font-bold text-white font-mono">
                    {formatZAR(price.total)}
                  </span>
                  <span className="block text-neutral-400 text-xs mt-1">
                    incl. {vatRate}% VAT ({formatZAR(price.subtotal)} excl.)
                  </span>
                </div>

                {/* Deliverables */}
                <ul className="flex-1 space-y-2 mb-6">
                  {pkg.deliverables.map((item) => (
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
                <a
                  href={`/book?package=${pkg.id}&category=${encodeURIComponent(pkg.category)}`}
                  className={`block w-full text-center py-3 rounded-lg font-semibold text-sm transition-colors ${
                    isFeatured
                      ? 'bg-[#D4A843] text-black hover:bg-[#c49a3a]'
                      : 'bg-neutral-800 text-white hover:bg-neutral-700'
                  }`}
                >
                  Book This Package
                </a>
              </div>
            );
          })}

          {/* Custom Project card */}
          <div className="relative flex flex-col rounded-xl border border-neutral-800 bg-neutral-900/50 hover:border-neutral-700 p-6 transition-colors">
            <h3 className="text-lg font-semibold text-white mt-1">
              Custom Project
            </h3>
            <p className="text-neutral-400 text-sm mt-1 mb-5">
              Tailored to your vision and budget
            </p>
            <div className="mb-5">
              <span className="text-2xl font-bold text-[#D4A843] font-mono">
                Get Custom Quote
              </span>
            </div>
            <ul className="flex-1 space-y-2 mb-6">
              {['Bespoke scope & timeline', 'Dedicated project manager', 'Flexible deliverables'].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-neutral-300">
                  <span className="text-[#D4A843] mt-0.5 shrink-0">&#10003;</span>
                  {item}
                </li>
              ))}
            </ul>
            <a
              href="#brief-form"
              className="block w-full text-center py-3 rounded-lg border border-[#D4A843] text-[#D4A843] font-semibold text-sm hover:bg-[#D4A843]/10 transition-colors"
            >
              Submit a Brief
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
