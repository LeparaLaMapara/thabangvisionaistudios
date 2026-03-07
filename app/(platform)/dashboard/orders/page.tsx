'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ShoppingBag, Eye, Download } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Order as OrderType, OrderStatus } from '@/types/marketplace';

type OrderWithMeta = OrderType & {
  listing_title: string;
  listing_slug: string;
  listing_thumbnail: string | null;
  seller_name: string;
  type: 'purchase' | 'sale';
};

const STATUS_VARIANT: Record<OrderStatus, 'warning' | 'info' | 'success' | 'default' | 'error'> = {
  pending: 'warning',
  paid: 'info',
  shipped: 'info',
  delivered: 'success',
  completed: 'success',
  cancelled: 'error',
  refunded: 'error',
};

const TABS = [
  { id: 'purchases', label: 'Purchases' },
  { id: 'sales', label: 'Sales' },
];

export default function OrdersPage() {
  const [activeTab, setActiveTab] = useState('purchases');
  const [purchases, setPurchases] = useState<OrderWithMeta[]>([]);
  const [sales, setSales] = useState<OrderWithMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/orders?role=buyer').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/orders?role=seller').then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([buyerData, sellerData]) => {
        if (Array.isArray(buyerData))
          setPurchases(buyerData.map((o: OrderWithMeta) => ({ ...o, type: 'purchase' as const })));
        if (Array.isArray(sellerData))
          setSales(sellerData.map((o: OrderWithMeta) => ({ ...o, type: 'sale' as const })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const orders = [...purchases, ...sales];

  if (loading) {
    return <LoadingSpinner label="Loading orders..." className="py-20" />;
  }

  const filtered = orders.filter((o) => {
    if (activeTab === 'purchases') return o.type === 'purchase';
    return o.type === 'sale';
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h2 className="text-lg font-display font-medium uppercase text-black dark:text-white mb-6">
        Orders
      </h2>

      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} className="mb-8" />

      {filtered.length === 0 ? (
        <EmptyState
          title={
            activeTab === 'purchases'
              ? 'No Purchases Yet'
              : 'No Sales Yet'
          }
          description={
            activeTab === 'purchases'
              ? 'Your marketplace purchases will appear here.'
              : 'When someone buys from your listings, it will appear here.'
          }
          action={
            activeTab === 'purchases'
              ? { label: 'Browse Marketplace', href: '/marketplace' }
              : { label: 'Create Listing', href: '/marketplace/new' }
          }
          icon={<ShoppingBag className="w-8 h-8" />}
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((order) => (
            <Card key={order.id} className="p-0 overflow-hidden">
              <div className="flex flex-col sm:flex-row">
                {/* Thumbnail */}
                <div className="relative w-full sm:w-32 h-28 sm:h-auto bg-neutral-100 dark:bg-neutral-900 flex-shrink-0">
                  {order.listing_thumbnail ? (
                    <Image
                      src={order.listing_thumbnail}
                      alt={order.listing_title}
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
                          {order.listing_title}
                        </h3>
                        <Badge variant={STATUS_VARIANT[order.status]}>
                          {order.status}
                        </Badge>
                      </div>
                      <p className="text-[9px] font-mono text-neutral-500">
                        {activeTab === 'purchases'
                          ? `Seller: ${order.seller_name}`
                          : `Order #${order.id.slice(0, 8)}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono font-bold text-black dark:text-white">
                        {order.currency} {order.total.toLocaleString()}
                      </p>
                      {activeTab === 'sales' && order.platform_fee > 0 && (
                        <p className="text-[9px] font-mono text-neutral-500">
                          Fee: {order.currency} {order.platform_fee}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-3">
                    <p className="text-[10px] font-mono text-neutral-500">
                      {new Date(order.created_at).toLocaleDateString(
                        'en-ZA',
                        {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        },
                      )}
                    </p>
                    <div className="flex items-center gap-2">
                      <Link href={`/marketplace/${order.listing_id}`}>
                        <Button variant="ghost" size="sm">
                          <Eye className="w-3 h-3" />
                          View
                        </Button>
                      </Link>
                      {order.status === 'delivered' && (
                        <Button variant="ghost" size="sm">
                          <Download className="w-3 h-3" />
                          Invoice
                        </Button>
                      )}
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
