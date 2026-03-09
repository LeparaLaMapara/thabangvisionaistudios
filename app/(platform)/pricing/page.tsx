'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Check, Zap } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { STUDIO } from '@/lib/constants';

type BillingPeriod = 'monthly' | 'annual';

type Plan = {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number;
  currency: string;
  features: string[];
  highlighted: boolean;
  cta: string;
};

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Starter',
    description: 'Perfect for getting started on the platform.',
    monthlyPrice: 0,
    annualPrice: 0,
    currency: STUDIO.currency.code,
    features: [
      'Browse all rentals',
      'Book equipment rentals',
      'Basic creator profile',
      'Up to 3 active listings',
      'Community access',
    ],
    highlighted: false,
    cta: 'Get Started',
  },
  {
    id: 'pro',
    name: 'Pro Creator',
    description: 'For active creators who sell and rent regularly.',
    monthlyPrice: 299,
    annualPrice: 2_990,
    currency: STUDIO.currency.code,
    features: [
      'Everything in Starter',
      'Unlimited listings',
      'Reduced platform fee (7%)',
      'Priority support',
      'Verified badge',
      'Analytics dashboard',
      'Featured listing credits (2/mo)',
    ],
    highlighted: true,
    cta: 'Upgrade to Pro',
  },
  {
    id: 'studio',
    name: 'Studio',
    description: 'For production houses and teams.',
    monthlyPrice: 799,
    annualPrice: 7_990,
    currency: STUDIO.currency.code,
    features: [
      'Everything in Pro Creator',
      'Team accounts (up to 5)',
      'Lowest platform fee (5%)',
      'Custom branding',
      'Bulk booking discounts',
      'Dedicated account manager',
      'API access',
      'Invoice management',
    ],
    highlighted: false,
    cta: 'Contact Sales',
  },
];

export default function PricingPage() {
  const [billing, setBilling] = useState<BillingPeriod>('monthly');
  const [dbPlans, setDbPlans] = useState<Plan[]>([]);

  useEffect(() => {
    fetch('/api/subscriptions/plans')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          const mapped = data.map((p: Record<string, unknown>) => ({
            id: p.id as string,
            name: (p.name as string) ?? 'Plan',
            description: (p.description as string) ?? '',
            monthlyPrice: (p.price as number) ?? 0,
            annualPrice: Math.round(((p.price as number) ?? 0) * 10),
            currency: (p.currency as string) ?? STUDIO.currency.code,
            features: Array.isArray(p.features) ? p.features as string[] : [],
            highlighted: (p.name as string)?.toLowerCase().includes('pro') ?? false,
            cta: (p.price as number) === 0 ? 'Get Started' : `Upgrade to ${p.name}`,
          }));
          setDbPlans(mapped);
        }
      })
      .catch(() => {});
  }, []);

  const activePlans = dbPlans.length > 0 ? dbPlans : PLANS;

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0A0B] text-black dark:text-white pt-20 transition-colors duration-500">
      {/* Hero */}
      <section className="container mx-auto px-6 pt-16 pb-12 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
            Pricing
          </p>
          <h1 className="text-4xl md:text-6xl font-display font-medium uppercase tracking-tight mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-neutral-500 font-light max-w-xl mx-auto mb-10">
            Start free. Upgrade when you need more. All plans include access to
            equipment rentals and community gear listings.
          </p>

          {/* Billing toggle */}
          <div className="inline-flex border border-black/10 dark:border-white/10">
            <button
              onClick={() => setBilling('monthly')}
              className={[
                'px-5 py-2.5 text-[10px] font-mono uppercase tracking-widest transition-all',
                billing === 'monthly'
                  ? 'bg-black dark:bg-white text-white dark:text-black'
                  : 'text-neutral-500 hover:text-black dark:hover:text-white',
              ].join(' ')}
            >
              Monthly
            </button>
            <button
              onClick={() => setBilling('annual')}
              className={[
                'px-5 py-2.5 text-[10px] font-mono uppercase tracking-widest transition-all',
                billing === 'annual'
                  ? 'bg-black dark:bg-white text-white dark:text-black'
                  : 'text-neutral-500 hover:text-black dark:hover:text-white',
              ].join(' ')}
            >
              Annual
              <Badge variant="success" className="ml-2">
                Save 17%
              </Badge>
            </button>
          </div>
        </motion.div>
      </section>

      {/* Plans Grid */}
      <section className="container mx-auto px-6 pb-32">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {activePlans.map((plan, i) => {
            const price =
              billing === 'monthly' ? plan.monthlyPrice : plan.annualPrice;
            const period = billing === 'monthly' ? '/mo' : '/yr';

            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1, duration: 0.4 }}
              >
                <Card
                  className={[
                    'p-8 flex flex-col h-full',
                    plan.highlighted
                      ? 'border-black dark:border-white relative'
                      : '',
                  ].join(' ')}
                >
                  {plan.highlighted && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge variant="warning">
                        <Zap className="w-2.5 h-2.5 mr-1 inline" />
                        Most Popular
                      </Badge>
                    </div>
                  )}

                  <div className="mb-6">
                    <h3 className="text-lg font-display font-medium uppercase text-black dark:text-white mb-1">
                      {plan.name}
                    </h3>
                    <p className="text-xs text-neutral-500 font-mono leading-relaxed">
                      {plan.description}
                    </p>
                  </div>

                  <div className="mb-8">
                    <span className="text-4xl font-display font-medium text-black dark:text-white">
                      {price === 0
                        ? 'Free'
                        : `${plan.currency} ${price.toLocaleString()}`}
                    </span>
                    {price > 0 && (
                      <span className="text-sm font-mono text-neutral-500 ml-1">
                        {period}
                      </span>
                    )}
                  </div>

                  <ul className="space-y-3 mb-10 flex-1">
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-3 text-sm"
                      >
                        <Check className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span className="text-neutral-600 dark:text-neutral-400">
                          {feature}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {plan.id === 'studio' ? (
                    <Link href="/contact">
                      <Button
                        variant="outline"
                        className="w-full"
                      >
                        {plan.cta}
                      </Button>
                    </Link>
                  ) : plan.id === 'free' ? (
                    <Link href="/register">
                      <Button
                        variant="secondary"
                        className="w-full"
                      >
                        {plan.cta}
                      </Button>
                    </Link>
                  ) : (
                    <Button className="w-full">{plan.cta}</Button>
                  )}
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* FAQ note */}
        <div className="text-center mt-16">
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-400 dark:text-neutral-600">
            All prices in {STUDIO.currency.code}. Platform rental fee: 10% (Starter), 7%
            (Pro), 5% (Studio).{' '}
            <Link
              href="/contact"
              className="text-black dark:text-white underline underline-offset-2"
            >
              Questions? Contact us
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
