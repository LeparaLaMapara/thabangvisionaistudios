'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Plus, Package, Eye, Edit2, Trash2 } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Listing } from '@/types/marketplace';

type MyListing = Listing & {
  status: 'active' | 'draft' | 'sold' | 'removed';
  views: number;
};

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'default' | 'error'> = {
  active: 'success',
  draft: 'warning',
  sold: 'default',
  removed: 'error',
};

const TABS = [
  { id: 'active', label: 'Active' },
  { id: 'draft', label: 'Drafts' },
  { id: 'sold', label: 'Sold' },
];

export default function MyListingsPage() {
  const [activeTab, setActiveTab] = useState('active');
  const [listings, setListings] = useState<MyListing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/marketplace')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setListings(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this listing?')) return;
    try {
      const res = await fetch(`/api/marketplace/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setListings((prev) => prev.filter((l) => l.id !== id));
      }
    } catch {
      // silently fail
    }
  };

  if (loading) {
    return <LoadingSpinner label="Loading listings..." className="py-20" />;
  }

  const filtered = listings.filter((l) => {
    if (activeTab === 'active') return l.status === 'active';
    if (activeTab === 'draft') return l.status === 'draft';
    return l.status === 'sold';
  });

  const priceLabel = (l: MyListing) => {
    const base = `${l.currency} ${l.price}`;
    if (l.pricing_model === 'daily') return `${base}/day`;
    if (l.pricing_model === 'hourly') return `${base}/hr`;
    if (l.pricing_model === 'weekly') return `${base}/wk`;
    if (l.pricing_model === 'monthly') return `${base}/mo`;
    return base;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-display font-medium uppercase text-black dark:text-white">
          My Listings
        </h2>
        <Link href="/marketplace/new">
          <Button size="sm">
            <Plus className="w-3 h-3" />
            New Listing
          </Button>
        </Link>
      </div>

      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} className="mb-8" />

      {filtered.length === 0 ? (
        <EmptyState
          title="No Listings"
          description={
            activeTab === 'active'
              ? 'You have no active listings. Create one to start selling on the marketplace.'
              : `No ${activeTab} listings found.`
          }
          action={
            activeTab === 'active'
              ? { label: 'Create Listing', href: '/marketplace/new' }
              : undefined
          }
          icon={<Package className="w-8 h-8" />}
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((listing) => (
            <Card key={listing.id} className="p-0 overflow-hidden">
              <div className="flex flex-col sm:flex-row">
                {/* Thumbnail */}
                <div className="relative w-full sm:w-36 h-28 sm:h-auto bg-neutral-100 dark:bg-neutral-900 flex-shrink-0">
                  {listing.thumbnail_url ? (
                    <Image
                      src={listing.thumbnail_url}
                      alt={listing.title}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] font-mono uppercase tracking-widest text-neutral-400">
                      No Image
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium text-black dark:text-white">
                          {listing.title}
                        </h3>
                        <Badge variant={STATUS_VARIANT[listing.status]}>
                          {listing.status}
                        </Badge>
                      </div>
                      <p className="text-[9px] font-mono uppercase tracking-widest text-neutral-500">
                        {listing.category}
                      </p>
                    </div>
                    <p className="text-sm font-mono font-bold text-black dark:text-white">
                      {priceLabel(listing)}
                    </p>
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <p className="text-[10px] font-mono text-neutral-500 flex items-center gap-1.5">
                      <Eye className="w-3 h-3" />
                      {listing.views} views
                    </p>
                    <div className="flex items-center gap-2">
                      <Link href={`/marketplace/${listing.id}`}>
                        <Button variant="ghost" size="sm">
                          <Eye className="w-3 h-3" />
                          View
                        </Button>
                      </Link>
                      <Button variant="ghost" size="sm">
                        <Edit2 className="w-3 h-3" />
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(listing.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </motion.div>
  );
}
