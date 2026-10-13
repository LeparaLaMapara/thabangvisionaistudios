import type { OrderStatus } from '@/types/order';

/**
 * The order steps a seller may make, one at a time and in order: a paid order
 * is shipped, then delivered, then completed. Before 2026-10-13 a seller could
 * jump any order (even a cancelled or unpaid one) straight to completed.
 */
const SELLER_MOVES: Partial<Record<OrderStatus, OrderStatus>> = {
  paid: 'shipped',
  shipped: 'delivered',
  delivered: 'completed',
};

export function canSellerMoveOrder(from: string, to: string): boolean {
  return SELLER_MOVES[from as OrderStatus] === to;
}
