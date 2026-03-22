'use client';

import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { ArrowLeft, Tag, Package, Check } from 'lucide-react';
import type { SmartRental } from '@/lib/supabase/queries/smartRentals';
import { Badge } from '@/components/ui/Badge';

interface Props {
  rental: SmartRental;
}

export default function CatalogDetailClient({ rental }: Props) {
  const heroImage = rental.thumbnail_url;
  const gallery = rental.gallery ?? [];
  const features = rental.features ?? [];
  const includes = rental.rental_includes ?? [];
  const tags = rental.tags ?? [];
  const metadata = rental.metadata ?? {};

  const displayPrice = rental.price_per_day
    ? `${rental.currency} ${rental.price_per_day}/day`
    : null;

  const weeklyPrice = rental.price_per_week
    ? `${rental.currency} ${rental.price_per_week}/week`
    : null;

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0A0B] text-black dark:text-white pt-20 transition-colors duration-500">
      {/* Breadcrumb */}
      <div className="container mx-auto px-6 py-6 flex items-center gap-4 text-xs tracking-widest text-neutral-500">
        <Link
          href="/smart-rentals"
          className="hover:text-black dark:hover:text-white transition-colors flex items-center gap-2"
        >
          <ArrowLeft className="w-3 h-3" /> BACK
        </Link>
        <span>/</span>
        <span className="uppercase">{rental.category}</span>
        <span>/</span>
        <span className="text-black dark:text-white font-bold uppercase">
          {rental.title}
        </span>
      </div>

      {/* Hero */}
      {heroImage && (
        <section className="relative h-[80vh] w-full overflow-hidden mb-20">
          <motion.div
            initial={{ scale: 1.1, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
            className="absolute inset-0"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent dark:from-[#0A0A0B] dark:via-transparent dark:to-transparent z-10" />
            <Image
              src={heroImage}
              alt={rental.title}
              fill
              sizes="100vw"
              className="object-cover"
              priority
            />
          </motion.div>

          <div className="absolute bottom-0 left-0 w-full z-20 pb-20 pt-32 bg-gradient-to-t from-white to-transparent dark:from-[#0A0A0B] dark:to-transparent">
            <div className="container mx-auto px-6">
              <motion.span
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="inline-block border border-black/10 dark:border-white/20 bg-white/50 dark:bg-black/50 backdrop-blur-sm px-3 py-1 text-[10px] font-bold tracking-widest uppercase mb-4 text-neutral-600 dark:text-neutral-300"
              >
                {rental.category}
                {rental.sub_category ? ` / ${rental.sub_category}` : ''}
              </motion.span>
              <motion.h1
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-5xl md:text-8xl font-black tracking-tighter uppercase mb-6 text-black dark:text-white"
              >
                {rental.title}
              </motion.h1>
              {rental.description && (
                <motion.p
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.9 }}
                  className="text-lg md:text-xl text-neutral-600 dark:text-neutral-400 max-w-2xl font-light leading-relaxed"
                >
                  {rental.description}
                </motion.p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Main Content */}
      <div className="container mx-auto px-6 pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left Column */}
          <div className="lg:col-span-8 space-y-20">
            {/* Features */}
            {features.length > 0 && (
              <section>
                <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-black dark:border-white pl-4">
                  KEY FEATURES
                </h2>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-3 bg-neutral-100 dark:bg-neutral-900/50 p-4 border border-black/5 dark:border-white/5"
                    >
                      <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-neutral-600 dark:text-neutral-400">
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Includes */}
            {includes.length > 0 && (
              <section>
                <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-black dark:border-white pl-4">
                  RENTAL INCLUDES
                </h2>
                <ul className="space-y-3">
                  {includes.map((item) => (
                    <li
                      key={item}
                      className="flex items-center gap-3 text-sm text-neutral-600 dark:text-neutral-400"
                    >
                      <Package className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Gallery */}
            {gallery.length > 0 && (
              <section>
                <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-black dark:border-white pl-4">
                  GALLERY
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  {gallery.map((img) => (
                    <div
                      key={img.public_id}
                      className="relative h-64 border border-black/5 dark:border-white/10 hover:border-black/20 dark:hover:border-white/30 transition-colors overflow-hidden"
                    >
                      <Image
                        src={img.url}
                        alt={rental.title}
                        fill
                        sizes="(max-width: 768px) 50vw, 33vw"
                        className="object-cover"
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Metadata / Specs */}
            {Object.keys(metadata).length > 0 && (
              <section>
                <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-black dark:border-white pl-4">
                  SPECIFICATIONS
                </h2>
                <dl className="space-y-4">
                  {Object.entries(metadata).map(([key, val]) => (
                    <div
                      key={key}
                      className="flex justify-between border-b border-black/10 dark:border-white/10 pb-2"
                    >
                      <dt className="text-neutral-500 text-sm capitalize">
                        {key.replace(/_/g, ' ')}
                      </dt>
                      <dd className="text-black dark:text-white text-sm font-mono">
                        {val}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>

          {/* Right Column — Pricing & Info */}
          <div className="lg:col-span-4">
            <div className="bg-neutral-100 dark:bg-neutral-900 p-8 border border-black/10 dark:border-white/10 sticky top-28">
              <h3 className="text-lg font-bold text-black dark:text-white mb-6 uppercase tracking-widest">
                Rental Info
              </h3>

              <dl className="space-y-4 mb-8">
                {rental.brand && (
                  <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-2">
                    <dt className="text-neutral-500 text-sm">Brand</dt>
                    <dd className="text-black dark:text-white text-sm font-mono">
                      {rental.brand}
                    </dd>
                  </div>
                )}
                {rental.model && (
                  <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-2">
                    <dt className="text-neutral-500 text-sm">Model</dt>
                    <dd className="text-black dark:text-white text-sm font-mono">
                      {rental.model}
                    </dd>
                  </div>
                )}
                {displayPrice && (
                  <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-2">
                    <dt className="text-neutral-500 text-sm">Daily Rate</dt>
                    <dd className="text-black dark:text-white text-sm font-mono font-bold">
                      {displayPrice}
                    </dd>
                  </div>
                )}
                {weeklyPrice && (
                  <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-2">
                    <dt className="text-neutral-500 text-sm">Weekly Rate</dt>
                    <dd className="text-black dark:text-white text-sm font-mono font-bold">
                      {weeklyPrice}
                    </dd>
                  </div>
                )}
                {rental.deposit_amount != null && (
                  <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-2">
                    <dt className="text-neutral-500 text-sm">Deposit</dt>
                    <dd className="text-black dark:text-white text-sm font-mono">
                      {rental.currency} {rental.deposit_amount}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-2">
                  <dt className="text-neutral-500 text-sm">Availability</dt>
                  <dd>
                    <Badge variant={rental.is_available ? 'success' : 'error'}>
                      {rental.is_available ? 'In Stock' : 'Unavailable'}
                    </Badge>
                  </dd>
                </div>
              </dl>

              {tags.length > 0 && (
                <div className="mb-8">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-500 block mb-3">
                    Tags
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest border border-black/10 dark:border-white/10 px-2 py-0.5 text-neutral-500"
                      >
                        <Tag className="w-2.5 h-2.5" />
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <Link
                href="/contact"
                className="block w-full text-center text-[10px] font-mono font-bold tracking-widest border border-black dark:border-white text-black dark:text-white py-3 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-all uppercase"
              >
                Enquire Now
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
