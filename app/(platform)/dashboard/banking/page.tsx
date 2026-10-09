'use client';

import { motion } from 'framer-motion';
import BankingDetails from '@/components/dashboard/BankingDetails';
import { DashboardSubTabs, ACCOUNT_TABS_CREATOR } from '@/components/dashboard/DashboardSubTabs';
import { RENTAL_POLICY } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';

export default function BankingPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <DashboardSubTabs tabs={ACCOUNT_TABS_CREATOR} />
      <div className="mb-8">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
          Payouts
        </p>
        <h2 className="text-lg font-display font-medium uppercase text-white">
          Banking Details
        </h2>
        <p className="text-xs font-mono text-neutral-400 mt-2">
          Add your banking details to receive payouts from gear rentals and gigs.
        </p>
        <p className="text-xs font-mono text-neutral-400 mt-2">
          Renting gear? A bank account in your own name, checked by our payment provider, raises the gear you can
          hire at a time from {formatRand(RENTAL_POLICY.trustTierLimitsCents.contactable / 100)} to{' '}
          {formatRand(RENTAL_POLICY.trustTierLimitsCents.verified / 100)}, together with your ID check.
        </p>
      </div>

      <div className="max-w-lg">
        <BankingDetails />
      </div>
    </motion.div>
  );
}
