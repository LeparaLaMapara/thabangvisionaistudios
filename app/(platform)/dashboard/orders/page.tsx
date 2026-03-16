'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ShoppingBag, ArrowRight } from 'lucide-react';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { OrderStatus, OrderWithListing } from '@/types/order';

const STATUS_VARIANT: Record<OrderStatus, 'default' | 'warning' | 'success' | 'info' | 'error'> = {
  pending: 'warning',
  paid: 'info',
  shipped: 'info',
  delivered: 'success',
  completed: 'success',
  cancelled: 'error',
  refunded: 'error',
};

const TABS = [
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

export default function OrdersPage() {
  const [activeTab, setActiveTab] = useState('active');
  const [orders, setOrders] = useState<OrderWithListing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/orders')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setOrders(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingSpinner label="Loading orders..." className="py-20" />;
  }

  const filtered = orders.filter((o) => {
    if (activeTab === 'active')
      return ['pending', 'paid', 'shipped', 'delivered'].includes(o.status);
    if (activeTab === 'completed') return o.status === 'completed';
    return ['cancelled', 'refunded'].includes(o.status);
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h2 className="text-lg font-display font-medium uppercase text-black dark:text-white mb-6">
        My Orders
      </h2>

      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} className="mb-8" />

      {filtered.length === 0 ? (
        <EmptyState
          title="No Orders"
          description={
            activeTab === 'active'
              ? 'You have no active orders. Browse the marketplace to find gear.'
              : 'No orders found in this category.'
          }
          action={
            activeTab === 'active'
              ? { label: 'Browse Marketplace', href: '/marketplace' }
              : undefined
          }
          icon={<ShoppingBag className="w-8 h-8" />}
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((order) => (
            <Card key={order.id} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <Badge variant={STATUS_VARIANT[order.status]}>
                    {order.status}
                  </Badge>
                  <h3 className="text-sm font-medium text-black dark:text-white mt-2">
                    {order.listing_title ?? `Order #${order.id.slice(0, 8)}`}
                  </h3>
                </div>
                <p className="text-sm font-mono font-bold text-black dark:text-white">
                  {order.currency} {order.total.toLocaleString()}
                </p>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs font-mono text-neutral-500 flex items-center gap-2">
                  <ShoppingBag className="w-3 h-3" />
                  {new Date(order.created_at).toLocaleDateString('en-ZA', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
                <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 flex items-center gap-1">
                  <ArrowRight className="w-3 h-3" />
                  #{order.id.slice(0, 8)}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </motion.div>
  );
}
