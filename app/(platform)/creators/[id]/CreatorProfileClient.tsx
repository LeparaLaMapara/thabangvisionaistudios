'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  MapPin,
  Globe,
  CheckCircle,
  Mail,
  User,
  Camera,
  Package,
  Star,
} from 'lucide-react';
import type { Profile } from '@/lib/supabase/queries/profiles';
import type { SmartProduction } from '@/lib/supabase/queries/smartProductions';
import type { Listing } from '@/types/marketplace';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Rating } from '@/components/ui/Rating';
import { EmptyState } from '@/components/ui/EmptyState';

interface ReviewData {
  id: string;
  rating: number;
  comment: string | null;
  reviewer_name: string | null;
  created_at: string;
}

interface Props {
  profile: Profile;
  productions?: SmartProduction[];
  listings?: Listing[];
  reviews?: ReviewData[];
}

const SOCIAL_ICONS: Record<string, string> = {
  website: 'Globe',
  instagram: 'Instagram',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  twitter: 'X',
};

export default function CreatorProfileClient({
  profile,
  productions = [],
  listings = [],
  reviews = [],
}: Props) {
  const skills = profile.skills ?? [];
  const socialLinks = profile.social_links ?? {};
  const hasSocials = Object.keys(socialLinks).length > 0;
  const avgRating =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0A0B] text-black dark:text-white pt-20 transition-colors duration-500">
      {/* ── Cover Banner ── */}
      <div className="relative h-48 md:h-64 overflow-hidden">
        {profile.avatar_url ? (
          <motion.div
            initial={{ scale: 1.1, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
            className="absolute inset-0"
          >
            <Image
              src={profile.avatar_url}
              alt=""
              fill
              className="object-cover blur-2xl scale-110 opacity-40"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white dark:to-[#0A0A0B]" />
          </motion.div>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-accent-gold/20 via-neutral-900/50 to-[#0A0A0B]">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white dark:to-[#0A0A0B]" />
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="container mx-auto px-6 -mt-4 relative z-10 mb-2">
        <Link
          href="/"
          className="hover:text-accent-gold transition-colors flex items-center gap-2 text-xs tracking-widest text-neutral-500"
        >
          <ArrowLeft className="w-3 h-3" /> HOME
        </Link>
      </div>

      <div className="container mx-auto px-6 pb-32">
        <div className="max-w-4xl mx-auto">
          {/* Profile Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col sm:flex-row items-start gap-8 -mt-16 relative z-10 mb-16"
          >
            {/* Avatar */}
            <div className="relative w-28 h-28 rounded-full overflow-hidden border-4 border-white dark:border-[#0A0A0B] bg-neutral-100 dark:bg-neutral-900 flex-shrink-0 ring-2 ring-accent-gold/30">
              {profile.avatar_url ? (
                <Image
                  src={profile.avatar_url}
                  alt={profile.display_name ?? 'Creator'}
                  fill
                  className="object-cover"
                  priority
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-200 to-neutral-300 dark:from-neutral-800 dark:to-neutral-700">
                  <User className="w-12 h-12 text-neutral-400 dark:text-neutral-500" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 pt-4 sm:pt-8">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl md:text-4xl font-display font-medium uppercase tracking-tight">
                  {profile.display_name ?? 'Creator'}
                </h1>
                {profile.is_verified && (
                  <CheckCircle className="w-5 h-5 text-accent-gold flex-shrink-0" />
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 mb-4">
                {profile.location && (
                  <p className="flex items-center gap-1.5 text-sm text-neutral-500 font-mono">
                    <MapPin className="w-3.5 h-3.5" />
                    {profile.location}
                  </p>
                )}
                {reviews.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Rating value={Math.round(avgRating)} readOnly size="sm" />
                    <span className="text-xs font-mono text-neutral-500">
                      ({reviews.length} review{reviews.length !== 1 ? 's' : ''})
                    </span>
                  </div>
                )}
              </div>

              {profile.bio && (
                <p className="text-neutral-600 dark:text-neutral-400 font-light leading-relaxed max-w-xl mb-6">
                  {profile.bio}
                </p>
              )}

              {/* Contact Creator button */}
              <a
                href={`mailto:contact@thabangvision.com?subject=Inquiry about ${profile.display_name ?? 'Creator'}`}
                className="inline-flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest bg-accent-gold text-black px-6 py-3 hover:bg-accent-gold-light transition-colors"
              >
                <Mail className="w-3.5 h-3.5" />
                Contact Creator
              </a>
            </div>
          </motion.div>

          {/* Skills */}
          {skills.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="mb-16"
            >
              <h2 className="text-sm font-bold tracking-tight mb-6 border-l-2 border-accent-gold pl-4 uppercase">
                Skills
              </h2>
              <div className="flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <Badge key={skill}>{skill}</Badge>
                ))}
              </div>
            </motion.section>
          )}

          {/* Portfolio — Productions */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="mb-16"
          >
            <h2 className="text-sm font-bold tracking-tight mb-6 border-l-2 border-accent-gold pl-4 uppercase flex items-center gap-2">
              <Camera className="w-4 h-4" />
              Portfolio
            </h2>
            {productions.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {productions.map((prod) => (
                  <Link
                    key={prod.id}
                    href={`/smart-production/${prod.slug}`}
                    className="group relative aspect-[3/2] overflow-hidden bg-neutral-100 dark:bg-neutral-900 border border-black/5 dark:border-white/5 hover:border-accent-gold/50 transition-all"
                  >
                    {prod.thumbnail_url ? (
                      <Image
                        src={prod.thumbnail_url}
                        alt={prod.title}
                        fill
                        sizes="(max-width: 768px) 50vw, 33vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Camera className="w-8 h-8 text-neutral-300 dark:text-neutral-700" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                      <span className="text-white text-xs font-mono uppercase tracking-widest truncate">
                        {prod.title}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No productions yet"
                description="This creator hasn't published any productions yet."
                icon={<Camera className="w-10 h-10" />}
              />
            )}
          </motion.section>

          {/* Active Gear Listings */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className="mb-16"
          >
            <h2 className="text-sm font-bold tracking-tight mb-6 border-l-2 border-accent-gold pl-4 uppercase flex items-center gap-2">
              <Package className="w-4 h-4" />
              Active Gear Listings
            </h2>
            {listings.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {listings.map((listing) => (
                  <Card key={listing.id} hover>
                    <Link
                      href={`/marketplace/${listing.slug}`}
                      className="flex gap-4 p-4"
                    >
                      <div className="relative w-20 h-20 flex-shrink-0 bg-neutral-100 dark:bg-neutral-900 overflow-hidden">
                        {listing.thumbnail_url ? (
                          <Image
                            src={listing.thumbnail_url}
                            alt={listing.title}
                            fill
                            sizes="80px"
                            className="object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Package className="w-6 h-6 text-neutral-300 dark:text-neutral-700" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-display font-medium uppercase text-black dark:text-white truncate">
                          {listing.title}
                        </p>
                        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mt-1">
                          {listing.category}
                        </p>
                        {listing.price != null && (
                          <p className="text-sm font-mono font-bold text-accent-gold mt-2">
                            {listing.currency} {listing.price.toLocaleString()}
                          </p>
                        )}
                      </div>
                    </Link>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No active listings"
                description="This creator doesn't have any gear listed on the marketplace yet."
                icon={<Package className="w-10 h-10" />}
              />
            )}
          </motion.section>

          {/* Reviews */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.4 }}
            className="mb-16"
          >
            <h2 className="text-sm font-bold tracking-tight mb-6 border-l-2 border-accent-gold pl-4 uppercase flex items-center gap-2">
              <Star className="w-4 h-4" />
              Reviews
              {reviews.length > 0 && (
                <span className="text-neutral-500 font-normal">
                  ({avgRating.toFixed(1)} avg)
                </span>
              )}
            </h2>
            {reviews.length > 0 ? (
              <div className="space-y-4">
                {reviews.map((review) => (
                  <div
                    key={review.id}
                    className="border border-black/5 dark:border-white/5 p-5 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                          <User className="w-4 h-4 text-neutral-400" />
                        </div>
                        <div>
                          <p className="text-xs font-mono font-bold text-black dark:text-white">
                            {review.reviewer_name ?? 'Anonymous'}
                          </p>
                          <p className="text-[9px] font-mono text-neutral-500">
                            {new Date(review.created_at).toLocaleDateString('en-ZA', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                        </div>
                      </div>
                      <Rating value={review.rating} readOnly size="sm" />
                    </div>
                    {review.comment && (
                      <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                        {review.comment}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No reviews yet"
                description="This creator hasn't received any reviews yet."
                icon={<Star className="w-10 h-10" />}
              />
            )}
          </motion.section>

          {/* Social Links */}
          {hasSocials && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.4 }}
              className="mb-16"
            >
              <h2 className="text-sm font-bold tracking-tight mb-6 border-l-2 border-accent-gold pl-4 uppercase">
                Connect
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Object.entries(socialLinks)
                  .filter(([, url]) => {
                    // H10: Only render links with safe protocols (http/https)
                    try {
                      const parsed = new URL(url);
                      return ['https:', 'http:'].includes(parsed.protocol);
                    } catch { return false; }
                  })
                  .map(([platform, url]) => (
                  <Card key={platform} hover>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-4"
                    >
                      <Globe className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-0.5">
                          {SOCIAL_ICONS[platform] ?? platform}
                        </p>
                        <p className="text-xs font-mono text-black dark:text-white truncate max-w-[200px]">
                          {url}
                        </p>
                      </div>
                    </a>
                  </Card>
                ))}
              </div>
            </motion.section>
          )}

          {/* Member Since */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7, duration: 0.4 }}
            className="text-center border-t border-black/10 dark:border-white/10 pt-8"
          >
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-400 dark:text-neutral-600">
              Member since{' '}
              {new Date(profile.created_at).toLocaleDateString('en-ZA', {
                year: 'numeric',
                month: 'long',
              })}
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
