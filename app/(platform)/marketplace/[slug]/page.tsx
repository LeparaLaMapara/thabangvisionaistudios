'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  MapPin,
  Calendar,
  MessageSquare,
  ShoppingCart,
  CheckCircle,
  Share2,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Rating } from '@/components/ui/Rating';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';

import type { Listing, Review, PricingModel } from '@/types/marketplace';
import type { Profile } from '@/lib/supabase/queries/profiles';

type ListingWithSeller = Listing & {
  seller_profile?: Profile | null;
  average_rating?: number;
  review_count?: number;
};

type ReviewWithReviewer = Review & {
  reviewer_profile?: Profile | null;
  reviewer_name?: string;
  reviewer_avatar?: string | null;
};

const DETAIL_TABS = [
  { id: 'description', label: 'Description' },
  { id: 'reviews', label: 'Reviews' },
];

export default function ListingDetailPage() {
  const { slug: listingId } = useParams<{ slug: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('description');
  const [selectedImage, setSelectedImage] = useState(0);
  const [listing, setListing] = useState<ListingWithSeller | null>(null);
  const [reviews, setReviews] = useState<ReviewWithReviewer[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/marketplace/${listingId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setListing(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [listingId]);

  const handleBuyNow = async () => {
    if (!listing) return;
    setOrdering(true);
    setOrderError(null);
    try {
      const res = await fetch(`/api/marketplace/${listing.id}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        setOrderError(data.error ?? 'Failed to place order.');
        return;
      }
      router.push('/dashboard/orders');
    } catch {
      setOrderError('Something went wrong. Please try again.');
    } finally {
      setOrdering(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0A0A0B] pt-32 pb-20">
        <LoadingSpinner label="Loading listing..." className="py-20" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0A0A0B] pt-32 pb-20">
        <div className="container mx-auto px-6">
          <EmptyState
            title="Listing Not Found"
            description="This listing may have been removed or does not exist."
            action={{ label: 'Browse Marketplace', href: '/marketplace' }}
          />
        </div>
      </div>
    );
  }

  const gallery = [
    ...(listing.thumbnail_url
      ? [{ url: listing.thumbnail_url, public_id: 'thumb' }]
      : []),
    ...(listing.gallery ?? []),
  ];

  const pricingSuffix: Record<PricingModel, string> = {
    fixed: '',
    hourly: '/hr',
    daily: '/day',
    weekly: '/wk',
    monthly: '/mo',
  };

  const priceLabel = () => {
    const base = `${listing.currency} ${listing.price}`;
    return `${base}${pricingSuffix[listing.pricing_model] ?? ''}`;
  };

  const sellerName = listing.seller_profile?.display_name ?? 'Seller';
  const sellerAvatar = listing.seller_profile?.avatar_url ?? null;
  const sellerLocation = listing.seller_profile?.location ?? listing.location;
  const sellerVerified = listing.seller_profile?.is_verified ?? false;

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0A0B] text-black dark:text-white pt-20 transition-colors duration-500">
      {/* Breadcrumb */}
      <div className="container mx-auto px-6 py-6 flex items-center gap-4 text-xs tracking-widest text-neutral-500">
        <Link
          href="/marketplace"
          className="hover:text-black dark:hover:text-white transition-colors flex items-center gap-2"
        >
          <ArrowLeft className="w-3 h-3" /> MARKETPLACE
        </Link>
        <span>/</span>
        <span className="uppercase">{listing.category ?? 'Uncategorized'}</span>
        <span>/</span>
        <span className="text-black dark:text-white font-bold uppercase truncate">
          {listing.title}
        </span>
      </div>

      <div className="container mx-auto px-6 pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left: Gallery + Tabs */}
          <div className="lg:col-span-8 space-y-10">
            {/* Gallery */}
            {gallery.length > 0 && (
              <div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                  className="relative h-[50vh] border border-black/5 dark:border-white/10 overflow-hidden mb-4"
                >
                  <Image
                    src={gallery[selectedImage].url}
                    alt={listing.title}
                    fill
                    className="object-cover"
                    priority
                  />
                </motion.div>
                {gallery.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto">
                    {gallery.map((img, i) => (
                      <button
                        key={img.public_id}
                        onClick={() => setSelectedImage(i)}
                        className={[
                          'relative w-20 h-20 flex-shrink-0 border overflow-hidden transition-all',
                          i === selectedImage
                            ? 'border-black dark:border-white'
                            : 'border-black/10 dark:border-white/10 opacity-60 hover:opacity-100',
                        ].join(' ')}
                      >
                        <Image
                          src={img.url}
                          alt=""
                          fill
                          className="object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tabs */}
            <Tabs
              tabs={DETAIL_TABS}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />

            <div className="mt-6">
              {activeTab === 'description' && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <p className="text-neutral-600 dark:text-neutral-400 font-light leading-relaxed whitespace-pre-line">
                    {listing.description ?? 'No description provided.'}
                  </p>

                  {listing.features && listing.features.length > 0 && (
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-tight mb-4 border-l-2 border-black dark:border-white pl-4">
                        Features
                      </h3>
                      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {listing.features.map((f) => (
                          <li
                            key={f}
                            className="flex items-start gap-3 bg-neutral-100 dark:bg-neutral-900/50 p-3 border border-black/5 dark:border-white/5"
                          >
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <span className="text-sm text-neutral-600 dark:text-neutral-400">
                              {f}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {listing.condition && (
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                        Condition:
                      </span>
                      <Badge>{listing.condition}</Badge>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'reviews' && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {reviews.length === 0 ? (
                    <EmptyState
                      title="No Reviews Yet"
                      description="Be the first to leave a review after purchasing."
                      icon={
                        <MessageSquare className="w-8 h-8" />
                      }
                    />
                  ) : (
                    <div className="space-y-6">
                      {reviews.map((review) => (
                        <Card key={review.id} className="p-5">
                          <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-full bg-neutral-200 dark:bg-neutral-800 flex-shrink-0 overflow-hidden">
                              {review.reviewer_profile?.avatar_url ? (
                                <Image
                                  src={review.reviewer_profile.avatar_url}
                                  alt=""
                                  width={40}
                                  height={40}
                                  className="object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-xs font-display font-bold text-neutral-400">
                                  {(review.reviewer_profile?.display_name ?? 'U')[0]?.toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-1">
                                <span className="text-sm font-medium text-black dark:text-white">
                                  {review.reviewer_profile?.display_name ?? 'Anonymous'}
                                </span>
                                <Rating
                                  value={review.rating}
                                  readOnly
                                  size="sm"
                                />
                              </div>
                              <p className="text-xs text-neutral-500 font-mono mb-2">
                                {new Date(
                                  review.created_at,
                                ).toLocaleDateString('en-ZA')}
                              </p>
                              {review.comment && (
                                <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                                  {review.comment}
                                </p>
                              )}
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </div>

          {/* Right: Pricing & Seller */}
          <div className="lg:col-span-4">
            <div className="bg-neutral-100 dark:bg-neutral-900 p-8 border border-black/10 dark:border-white/10 sticky top-28 space-y-6">
              {/* Price */}
              <div>
                <p className="text-[9px] font-mono uppercase tracking-widest text-neutral-500 mb-1">
                  Price
                </p>
                <p className="text-3xl font-display font-medium text-black dark:text-white">
                  {priceLabel()}
                </p>
              </div>

              {/* Rating */}
              {(listing.review_count ?? 0) > 0 && (
                <div className="flex items-center gap-2">
                  <Rating
                    value={listing.average_rating ?? 0}
                    readOnly
                    size="sm"
                  />
                  <span className="text-[10px] font-mono text-neutral-500">
                    {(listing.average_rating ?? 0).toFixed(1)} (
                    {listing.review_count} reviews)
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-3">
                <Button className="w-full" onClick={handleBuyNow} loading={ordering}>
                  <ShoppingCart className="w-3.5 h-3.5" />
                  Buy Now
                </Button>
                {orderError && (
                  <p className="text-xs text-red-600 dark:text-red-400 font-mono mt-1">
                    {orderError}
                  </p>
                )}
                <Button variant="outline" className="w-full">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Contact Seller
                </Button>
                <Button variant="ghost" className="w-full">
                  <Share2 className="w-3.5 h-3.5" />
                  Share
                </Button>
              </div>

              {/* Seller Card */}
              <div className="border-t border-black/10 dark:border-white/10 pt-6">
                <p className="text-[9px] font-mono uppercase tracking-widest text-neutral-500 mb-4">
                  Seller
                </p>
                <Link
                  href={`/creators/${listing.user_id}`}
                  className="flex items-center gap-3 group"
                >
                  <div className="w-10 h-10 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden flex-shrink-0">
                    {sellerAvatar ? (
                      <Image
                        src={sellerAvatar}
                        alt=""
                        width={40}
                        height={40}
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs font-bold text-neutral-400">
                        {sellerName[0]?.toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-black dark:text-white group-hover:underline">
                        {sellerName}
                      </span>
                      {sellerVerified && (
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                      )}
                    </div>
                    {sellerLocation && (
                      <p className="text-[9px] font-mono text-neutral-500 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-2.5 h-2.5" />
                        {sellerLocation}
                      </p>
                    )}
                  </div>
                </Link>
              </div>

              {/* Listed date */}
              <div className="flex items-center gap-2 text-[9px] font-mono text-neutral-500">
                <Calendar className="w-3 h-3" />
                Listed{' '}
                {new Date(listing.created_at).toLocaleDateString('en-ZA', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
