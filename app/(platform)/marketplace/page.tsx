'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Search, SlidersHorizontal, Plus, MapPin } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { Rating } from '@/components/ui/Rating';

import type { Listing, PricingModel } from '@/types/marketplace';

type ListingWithMeta = Listing & {
  seller_name?: string;
  seller_location?: string | null;
  average_rating?: number;
  review_count?: number;
};

const CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'services', label: 'Services' },
  { value: 'presets', label: 'Presets & LUTs' },
  { value: 'templates', label: 'Templates' },
  { value: 'stock', label: 'Stock Media' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'rating', label: 'Highest Rated' },
];

const ITEMS_PER_PAGE = 12;

export default function MarketplacePage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [listings, setListings] = useState<ListingWithMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    const qs = params.toString();
    fetch(`/api/marketplace${qs ? `?${qs}` : ''}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setListings(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [category]);

  const filtered = useMemo(() => {
    let result = [...listings];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          l.description?.toLowerCase().includes(q),
      );
    }

    if (category) {
      result = result.filter((l) => l.category === category);
    }

    switch (sortBy) {
      case 'price_asc':
        result.sort((a, b) => a.price - b.price);
        break;
      case 'price_desc':
        result.sort((a, b) => b.price - a.price);
        break;
      case 'rating':
        result.sort((a, b) => (b.average_rating ?? 0) - (a.average_rating ?? 0));
        break;
      default:
        result.sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime(),
        );
    }

    return result;
  }, [listings, search, category, sortBy]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  );

  const pricingSuffix: Record<PricingModel, string> = {
    fixed: '',
    hourly: '/hr',
    daily: '/day',
    weekly: '/wk',
    monthly: '/mo',
  };

  const priceLabel = (l: ListingWithMeta) => {
    const base = `${l.currency} ${l.price}`;
    return `${base}${pricingSuffix[l.pricing_model] ?? ''}`;
  };

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0A0B] text-black dark:text-white pt-20 transition-colors duration-500">
      {/* Hero */}
      <section className="container mx-auto px-6 pt-12 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
            Creator Marketplace
          </p>
          <h1 className="text-4xl md:text-6xl font-display font-medium uppercase tracking-tight mb-4">
            Buy, Sell & Trade
          </h1>
          <p className="text-neutral-500 font-light max-w-xl mb-8">
            A peer-to-peer marketplace for South African creatives. List your
            gear, sell presets, offer services, or find exactly what you need
            for your next project.
          </p>
          <Link href="/marketplace/new">
            <Button>
              <Plus className="w-3 h-3" />
              Create Listing
            </Button>
          </Link>
        </motion.div>
      </section>

      {/* Search & Filters */}
      <section className="border-y border-black/10 dark:border-white/10 bg-neutral-50 dark:bg-neutral-950">
        <div className="container mx-auto px-6 py-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search listings..."
                className="pl-11"
              />
            </div>
            <div className="flex gap-3">
              <Select
                options={CATEGORIES}
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setPage(1);
                }}
                className="w-44"
              />
              <Select
                options={SORT_OPTIONS}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-44"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="md:hidden"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Listings Grid */}
      <section className="container mx-auto px-6 py-12">
        {loading ? (
          <LoadingSpinner label="Loading listings..." className="py-20" />
        ) : paginated.length === 0 ? (
          <EmptyState
            title="No Listings Yet"
            description="Be the first to list something on the marketplace. Equipment, services, presets, and more."
            action={{ label: 'Create Listing', href: '/marketplace/new' }}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {paginated.map((listing, i) => (
                <motion.div
                  key={listing.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.3 }}
                >
                  <Link href={`/marketplace/${listing.id}`}>
                    <Card hover className="overflow-hidden group">
                      {/* Thumbnail */}
                      <div className="relative h-48 bg-neutral-100 dark:bg-neutral-900 overflow-hidden">
                        {listing.thumbnail_url ? (
                          <Image
                            src={listing.thumbnail_url}
                            alt={listing.title}
                            fill
                            className="object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-neutral-300 dark:text-neutral-700">
                            <span className="text-[10px] font-mono uppercase tracking-widest">
                              No Image
                            </span>
                          </div>
                        )}
                        {listing.is_featured && (
                          <div className="absolute top-3 left-3">
                            <Badge variant="warning">Featured</Badge>
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="p-4">
                        <Badge className="mb-2">{listing.category ?? 'General'}</Badge>
                        <h3 className="text-sm font-medium text-black dark:text-white truncate mb-1">
                          {listing.title}
                        </h3>
                        <p className="text-xs text-neutral-500 font-mono mb-3">
                          {listing.seller_name ?? 'Seller'}
                          {listing.seller_location && (
                            <span className="inline-flex items-center gap-1 ml-2">
                              <MapPin className="w-2.5 h-2.5" />
                              {listing.seller_location}
                            </span>
                          )}
                        </p>

                        <div className="flex items-center justify-between">
                          <span className="text-sm font-mono font-bold text-black dark:text-white">
                            {priceLabel(listing)}
                          </span>
                          {(listing.review_count ?? 0) > 0 && (
                            <div className="flex items-center gap-1.5">
                              <Rating
                                value={listing.average_rating ?? 0}
                                readOnly
                                size="sm"
                              />
                              <span className="text-[9px] font-mono text-neutral-500">
                                ({listing.review_count})
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </div>

            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
              className="mt-12"
            />
          </>
        )}
      </section>
    </div>
  );
}
