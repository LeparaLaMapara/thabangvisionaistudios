'use client';

import { motion } from 'framer-motion';
import BankingDetails from '@/components/dashboard/BankingDetails';

export default function BankingPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="mb-8">
        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
          Payouts
        </p>
        <h2 className="text-lg font-display font-medium uppercase text-white">
          Banking Details
        </h2>
        <p className="text-xs font-mono text-neutral-500 mt-2">
          Add your banking details to receive payouts from gear rentals and gigs.
        </p>
      </div>

      <div className="max-w-lg">
        <BankingDetails />
      </div>
    </motion.div>
  );
}
