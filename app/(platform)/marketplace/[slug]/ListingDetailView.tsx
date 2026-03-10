'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, MapPin, Tag, ShoppingBag, Wrench, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { PhotographyGallery } from '@/components/projects/ProjectsComponents';
import type { Listing } from '@/types/marketplace';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPrice(price: number, currency: string, pricingModel: string) {
  const formatted = new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: currency || 'ZAR',
    minimumFractionDigits: 0,
  }).format(price);

  const suffix: Record<string, string> = {
    hourly: '/hr',
    daily: '/day',
    weekly: '/wk',
    monthly: '/mo',
  };

  return `${formatted}${suffix[pricingModel] ?? ''}`;
}

function conditionLabel(condition: string | null) {
  if (!condition) return null;
  const labels: Record<string, string> = {
    new: 'New',
    'like-new': 'Like New',
    good: 'Good',
    fair: 'Fair',
    poor: 'Poor',
  };
  return labels[condition] ?? condition;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ListingDetailView({
  listing,
}: {
  listing: Listing;
}) {
  const galleryUrls = listing.gallery?.map((g) => g.url) ?? [];
  const condition = conditionLabel(listing.condition);

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] transition-colors duration-500 pt-20">
      {/* Back nav */}
      <div className="container mx-auto px-6 py-8">
        <Link
          href="/marketplace"
          className="inline-flex items-center gap-2 text-[10px] font-mono font-bold tracking-widest text-neutral-500 hover:text-black dark:hover:text-white uppercase mb-8 transition-colors"
        >
          <ArrowLeft className="w-3 h-3" /> Back to Marketplace
        </Link>
      </div>

      {/* Hero image / gallery */}
      <div className="container mx-auto px-0 md:px-6 mb-16">
        {galleryUrls.length > 0 ? (
          <PhotographyGallery images={galleryUrls} />
        ) : listing.thumbnail_url ? (
          <div className="relative aspect-video w-full bg-black overflow-hidden shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={listing.thumbnail_url}
              alt={listing.title}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="relative aspect-video w-full bg-neutral-100 dark:bg-neutral-900 overflow-hidden shadow-2xl flex items-center justify-center">
            {listing.type === 'gear' ? (
              <ShoppingBag className="w-20 h-20 text-neutral-300 dark:text-neutral-700" />
            ) : (
              <Wrench className="w-20 h-20 text-neutral-300 dark:text-neutral-700" />
            )}
          </div>
        )}
      </div>

      {/* Details */}
      <div className="container mx-auto px-6 pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
          {/* Left: title + description + tags */}
          <div className="lg:col-span-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 text-[10px] font-mono font-bold uppercase tracking-widest bg-black text-white dark:bg-white dark:text-black">
                {listing.type}
              </span>
              {listing.category && (
                <span className="px-3 py-1 text-[10px] font-mono uppercase tracking-widest border border-black/10 dark:border-white/10 text-neutral-500">
                  {listing.category.replace(/-/g, ' ')}
                </span>
              )}
            </div>

            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl md:text-6xl font-display font-medium text-black dark:text-white uppercase mb-6"
            >
              {listing.title}
            </motion.h1>

            {/* Tags */}
            {listing.tags && listing.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-8">
                {listing.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-3 py-1 border border-black/10 dark:border-white/10 text-[10px] font-mono uppercase tracking-widest text-neutral-600 dark:text-neutral-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Description */}
            {listing.description && (
              <div className="prose prose-lg text-neutral-600 dark:text-neutral-400 font-light leading-relaxed max-w-none mb-10">
                <p>{listing.description}</p>
              </div>
            )}

            {/* Features */}
            {listing.features && listing.features.length > 0 && (
              <div className="mb-10">
                <h3 className="text-[10px] font-mono font-bold text-neutral-500 uppercase tracking-widest mb-4">
                  Features
                </h3>
                <ul className="space-y-2">
                  {listing.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-3 text-sm text-neutral-600 dark:text-neutral-400 font-mono"
                    >
                      <span className="text-black dark:text-white mt-0.5">+</span>
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Right: meta + CTA */}
          <div className="lg:col-span-4 space-y-6">
            {/* Price card */}
            <div className="bg-neutral-50 dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 p-6">
              <span className="block text-[10px] font-mono text-neutral-500 uppercase tracking-widest mb-2">
                Price
              </span>
              <span className="text-3xl font-display font-bold text-black dark:text-white">
                {formatPrice(listing.price, listing.currency, listing.pricing_model)}
              </span>

              <Link
                href="/contact"
                className="mt-6 w-full flex items-center justify-center gap-2 text-xs font-mono font-bold uppercase tracking-widest bg-black text-white dark:bg-white dark:text-black px-6 py-4 hover:opacity-80 transition-opacity"
              >
                <MessageSquare className="w-4 h-4" />
                Contact Seller
              </Link>
            </div>

            {/* Meta fields */}
            {condition && (
              <div className="border-t border-black/10 dark:border-white/10 pt-4">
                <span className="block text-[10px] font-mono text-neutral-500 uppercase tracking-widest mb-1">
                  Condition
                </span>
                <span className="text-lg font-display text-black dark:text-white">
                  {condition}
                </span>
              </div>
            )}

            {listing.location && (
              <div className="border-t border-black/10 dark:border-white/10 pt-4">
                <span className="block text-[10px] font-mono text-neutral-500 uppercase tracking-widest mb-1">
                  Location
                </span>
                <span className="flex items-center gap-2 text-lg font-display text-black dark:text-white">
                  <MapPin className="w-4 h-4 text-neutral-400" />
                  {listing.location}
                </span>
              </div>
            )}

            {listing.pricing_model && listing.pricing_model !== 'fixed' && (
              <div className="border-t border-black/10 dark:border-white/10 pt-4">
                <span className="block text-[10px] font-mono text-neutral-500 uppercase tracking-widest mb-1">
                  Pricing Model
                </span>
                <span className="text-lg font-display text-black dark:text-white capitalize">
                  {listing.pricing_model}
                </span>
              </div>
            )}

            {listing.sub_category && (
              <div className="border-t border-black/10 dark:border-white/10 pt-4">
                <span className="block text-[10px] font-mono text-neutral-500 uppercase tracking-widest mb-1">
                  Sub-Category
                </span>
                <span className="text-lg font-display text-black dark:text-white">
                  {listing.sub_category.replace(/-/g, ' ')}
                </span>
              </div>
            )}

            <div className="border-t border-black/10 dark:border-white/10 pt-4">
              <span className="block text-[10px] font-mono text-neutral-500 uppercase tracking-widest mb-1">
                Listed
              </span>
              <span className="text-sm font-mono text-neutral-600 dark:text-neutral-400">
                {new Date(listing.created_at).toLocaleDateString('en-ZA', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
