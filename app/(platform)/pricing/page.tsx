'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Check, Zap } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { STUDIO } from '@/lib/constants';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';
import { isPaymentUrl } from '@/lib/payments/hosts';
import { usePaymentsOpen } from '@/lib/payments/usePaymentsOpen';
import { PaymentsNotOpenNote } from '@/components/booking/PaymentsNotOpenNote';

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
  /** The billing interval of a plan row from subscription_plans. A row has
   *  one interval; annual billing needs its own annual row. */
  interval?: BillingPeriod;
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
      'Browse all rentals and productions',
      'Book equipment rentals',
      'Basic creator profile',
      'Up to 3 active gear listings',
      'Chat with Ubunye AI (2 messages/day)',
      `${STUDIO.creators.commissionRate}% supplier commission on items you supply`,
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
      'Unlimited gear listings',
      'Verified supplier status',
      'Verified creator badge',
      'Priority in search rankings',
      'Analytics dashboard',
      'Featured listing credits (2/month)',
      'Priority support',
      '100 Ubunye messages/day',
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
      'Team accounts (up to 5 members)',
      'Priority supplier placement',
      'Custom studio branding',
      'Bulk booking discounts',
      'Dedicated account manager',
      'API access',
      'Invoice management',
      'Unlimited Ubunye messages',
    ],
    highlighted: false,
    cta: 'Contact Sales',
  },
];

export default function PricingPage() {
  const [billing, setBilling] = useState<BillingPeriod>('monthly');
  const [dbPlans, setDbPlans] = useState<Plan[]>([]);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Show cancellation notice if redirected back from the payment gateway
  const cancelled = searchParams.get('subscription') === 'cancelled';

  useEffect(() => {
    if (!STUDIO.subscriptions.enabled) return;
    fetch('/api/subscriptions/plans')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          // Each row is priced for its own interval by the server. No annual
          // price is derived on the client (it used to show monthly × 10).
          const mapped = data.map((p: Record<string, unknown>) => {
            const interval: BillingPeriod = p.interval === 'annual' ? 'annual' : 'monthly';
            const price = (p.price as number) ?? 0;
            return {
            id: p.id as string,
            name: (p.name as string) ?? 'Plan',
            description: (p.description as string) ?? '',
            interval,
            monthlyPrice: interval === 'monthly' ? price : 0,
            annualPrice: interval === 'annual' ? price : 0,
            currency: (p.currency as string) ?? STUDIO.currency.code,
            features: Array.isArray(p.features) ? p.features as string[] : [],
            highlighted: (p.name as string)?.toLowerCase().includes('pro') ?? false,
            cta: price === 0 ? 'Get Started' : `Upgrade to ${p.name}`,
            };
          });
          setDbPlans(mapped);
        }
      })
      .catch(() => {});
  }, []);

  // Annual billing is offered only when annual plan rows exist.
  const hasAnnual = dbPlans.some((p) => p.interval === 'annual');
  const activePlans = dbPlans.length > 0
    ? dbPlans.filter((p) => (p.interval ?? 'monthly') === (hasAnnual ? billing : 'monthly'))
    : PLANS;

  const handleCheckout = async (plan: Plan) => {
    setError(null);
    const price = billing === 'monthly' ? plan.monthlyPrice : plan.annualPrice;

    // Free plan — go to register
    if (price <= 0) {
      router.push('/register');
      return;
    }

    setLoadingPlan(plan.id);

    try {
      const res = await fetch('/api/payfast/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Exactly { plan_id, billing }: the server prices the plan and
        // rejects any other field (lib/payments/subscriptions.ts).
        body: JSON.stringify({ plan_id: plan.id, billing }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          // Not logged in — redirect to login with return URL
          router.push(`/login?redirect=/pricing`);
          return;
        }
        setError(data.error ?? 'Something went wrong. Please try again.');
        setLoadingPlan(null);
        return;
      }

      // H9: Validate URL points to a legitimate payment domain before redirecting
      if (data.payment_url) {
        try {
          if (!isPaymentUrl(data.payment_url)) {
            throw new Error('Invalid payment URL');
          }
          window.location.href = data.payment_url;
        } catch {
          setError('Invalid payment URL received. Please try again.');
          setLoadingPlan(null);
        }
        return;
      }

      // No payment URL (e.g., free plan handled server-side)
      router.push('/dashboard?subscription=success');
    } catch {
      setError('Network error. Please check your connection and try again.');
      setLoadingPlan(null);
    }
  };

  // Paid plans are off. Show what things actually cost instead of an empty
  // plan grid. Flip STUDIO.subscriptions.enabled to restore the plan cards.
  if (!STUDIO.subscriptions.enabled) {
    return <PayAsYouGoPricing />;
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0A0B] text-black dark:text-white pt-20 transition-colors duration-500">
      {/* Hero */}
      <section className="container mx-auto px-6 pt-16 pb-12 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-3">
            Pricing
          </p>
          <h1 className="text-4xl md:text-6xl font-display font-medium uppercase tracking-tight mb-4">
            Plans
          </h1>
          <p className="text-neutral-400 font-light max-w-xl mx-auto mb-10">
            Start free. All plans include access to
            equipment rentals and community gear listings.
          </p>

          {/* Cancellation notice */}
          {cancelled && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 inline-block bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-mono px-4 py-2"
            >
              Payment was cancelled. You can try again when you&apos;re ready.
            </motion.div>
          )}

          {/* Error message */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 inline-block bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-mono px-4 py-2 cursor-pointer"
              onClick={() => setError(null)}
            >
              {error}
            </motion.div>
          )}

          {/* Billing toggle: only when annual plan rows exist */}
          {hasAnnual && (
          <div className="inline-flex border border-black/10 dark:border-white/10">
            <button
              onClick={() => setBilling('monthly')}
              className={[
                'px-5 py-2.5 text-xs font-mono uppercase tracking-widest transition-all',
                billing === 'monthly'
                  ? 'bg-black dark:bg-white text-white dark:text-black'
                  : 'text-neutral-400 hover:text-black dark:hover:text-white',
              ].join(' ')}
            >
              Monthly
            </button>
            <button
              onClick={() => setBilling('annual')}
              className={[
                'px-5 py-2.5 text-xs font-mono uppercase tracking-widest transition-all',
                billing === 'annual'
                  ? 'bg-black dark:bg-white text-white dark:text-black'
                  : 'text-neutral-400 hover:text-black dark:hover:text-white',
              ].join(' ')}
            >
              Annual
            </button>
          </div>
          )}
        </motion.div>
      </section>

      {/* Plans Grid */}
      <section className="container mx-auto px-6 pb-32">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {activePlans.map((plan, i) => {
            const price =
              billing === 'monthly' ? plan.monthlyPrice : plan.annualPrice;
            const period = billing === 'monthly' ? '/mo' : '/yr';
            const isLoading = loadingPlan === plan.id;

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
                    <p className="text-xs text-neutral-400 font-mono leading-relaxed">
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
                      <span className="text-sm font-mono text-neutral-400 ml-1">
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
                        <span className="text-neutral-400 dark:text-neutral-400">
                          {feature}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {plan.id === 'free' ? (
                    <Link href="/register">
                      <Button variant="outline" className="w-full">
                        Get Started
                      </Button>
                    </Link>
                  ) : (
                    <Button
                      className="w-full bg-[#D4A843] text-neutral-950 hover:bg-[#E8C96A] font-bold"
                      loading={isLoading}
                      disabled={!!loadingPlan}
                      onClick={() => handleCheckout(plan)}
                    >
                      Upgrade Now
                    </Button>
                  )}
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* FAQ note */}
        <div className="text-center mt-16">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-neutral-400 dark:text-neutral-400">
            All prices in {STUDIO.currency.code}. {STUDIO.shortName} is the seller of record on
            every order. Where you supply an item or service, we retain a{' '}
            {STUDIO.creators.commissionRate}% commission and pay you the balance. Payments
            processed securely via our authorised payment gateway.{' '}
            <Link
              href="/contact"
              className="text-black dark:text-white underline underline-offset-2"
            >
              Questions? Contact us
            </Link>
          </p>
        </div>
      </section>
      <AskUbunyeButton prompt="Help me choose gear or a package for my shoot" label="Not sure what you need?" />
    </div>
  );
}

/**
 * Shown while STUDIO.subscriptions.enabled is false.
 * ThabangVision is free to join; you pay per booking.
 */
function PayAsYouGoPricing() {
  const paymentsOpen = usePaymentsOpen();
  // The supplier row ("Become a supplier") was removed on 2026-09-28: no
  // supplier listings exist yet and the site leads with our own gear.
  const rows = [
    {
      title: 'Rentals',
      body: `Charged at the daily or weekly rate shown on each listing. A refundable security deposit is shown with it and returned after the gear comes back and passes inspection.`,
      href: '/rentals',
      cta: 'Rent gear',
    },
    {
      title: 'Photo and video shoots',
      body: `By request. Each package shows its full price. Send a request and we confirm who will shoot it, the date and the price with you.`,
      href: '/studio',
      cta: 'See shoots',
    },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0A0B] text-black dark:text-white pt-20 transition-colors duration-500">
      <section className="container mx-auto px-6 pt-16 pb-12 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-3">
            Pricing
          </p>
          <h1 className="text-4xl md:text-6xl font-display font-medium uppercase tracking-tight mb-4">
            Pay For What You Book
          </h1>
          <p className="text-neutral-400 font-light max-w-xl mx-auto">
            No subscription and no monthly fee. Creating an account, browsing, and
            listing your profile cost nothing. You pay when you book.
          </p>
        </motion.div>
      </section>

      <section className="container mx-auto px-6 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {rows.map((row, i) => (
            <motion.div
              key={row.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
            >
              <Card className="h-full flex flex-col p-8">
                <h2 className="text-xs font-mono font-bold uppercase tracking-widest mb-4">
                  {row.title}
                </h2>
                <p className="text-sm text-neutral-400 dark:text-neutral-400 font-light leading-relaxed flex-1">
                  {row.body}
                </p>
                <Link
                  href={row.href}
                  className="mt-6 inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-black dark:text-white underline underline-offset-4"
                >
                  {row.cta}
                </Link>
              </Card>
            </motion.div>
          ))}
        </div>

        <PaymentsNotOpenNote open={paymentsOpen} className="justify-center text-center mt-12 max-w-2xl mx-auto" />

        <p className="text-center text-xs font-mono uppercase tracking-[0.2em] text-neutral-400 dark:text-neutral-400 mt-8">
          All prices are in Rand, and the price shown is the price you pay. You book and pay {STUDIO.shortName} directly.{' '}
          {paymentsOpen === false
            ? 'Pay by EFT to our business account, or in cash when you collect. See How to Pay.'
            : paymentsOpen
              ? 'Payments processed securely via our authorised payment gateway.'
              : ''}{' '}
          <Link href="/contact" className="text-black dark:text-white underline underline-offset-2">
            Questions? Contact us
          </Link>
        </p>
      </section>
    </div>
  );
}
