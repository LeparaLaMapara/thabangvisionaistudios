'use client';

import { useEffect, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import { ServiceGrid } from '@/components/cinematic/ServiceGrid';
import { LatestWorkCarousel, type CarouselItem } from '@/components/cinematic/LatestWorkCarousel';
import { ChevronRight, ArrowRight, Camera, Calendar, Users, Search, CreditCard, Sparkles, MessageCircle, ShieldCheck, BadgeCheck, Lock, Star } from 'lucide-react';
import { SITE_NAME, STUDIO, PLACEHOLDER_IMAGES, CAPABILITIES } from '@/lib/constants';
import { formatZAR } from '@/lib/productions/pricing';

type Capability = (typeof CAPABILITIES)[number];

// ─── Hero ────────────────────────────────────────────────────────────────────

/** A Cloudinary image at the size and format asked for (w_900,q_auto,f_auto...). */
function cld(url: string, transform: string): string {
  return url.includes('/image/upload/') ? url.replace('/image/upload/', `/image/upload/${transform}/`) : url;
}

const Hero = () => {
  const { scrollY } = useScroll();
  const y1 = useTransform(scrollY, [0, 500], [0, 200]);
  const opacity = useTransform(scrollY, [0, 300], [1, 0]);
  const { hero } = STUDIO;
  const useVideo = hero.type === 'video' && !!hero.videoSrc;
  const posterSrc = hero.poster || hero.imageSrc;
  const [showVideo, setShowVideo] = useState(false);
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 768px)').matches;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (wide && !calm && !saveData) {
      const id = window.setTimeout(() => setShowVideo(true), 0);
      return () => window.clearTimeout(id);
    }
  }, []);
  const filterClass = hero.colorMode === 'bw' ? 'grayscale contrast-125' : 'contrast-110 saturate-[0.85]';

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#050505] flex items-center justify-center transition-colors duration-500">
      <motion.div style={{ y: y1 }} className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-[#050505]/50 z-10" />

        {/* A right-sized picture first, shown at once (it is what people see
            first on a phone). The video is added only on larger screens, and
            never when the phone asks for less data or less motion: it was a
            1 MB download for everyone, plus a hidden 604 KB picture. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cld(posterSrc, 'w_900,q_auto,f_auto')}
          srcSet={`${cld(posterSrc, 'w_900,q_auto,f_auto')} 900w, ${cld(posterSrc, 'w_1920,q_auto,f_auto')} 1920w`}
          sizes="100vw"
          alt=""
          fetchPriority="high"
          className={`absolute inset-0 w-full h-full object-cover opacity-40 ${filterClass}`}
        />
        {useVideo && showVideo && (
          <video
            autoPlay
            loop
            muted
            playsInline
            className={`absolute inset-0 w-full h-full object-cover opacity-40 ${filterClass}`}
          >
            <source src={hero.videoSrc} type="video/mp4" />
          </video>
        )}
      </motion.div>

      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:100px_100px] pointer-events-none z-10" />

      <motion.div style={{ opacity }} className="relative z-20 px-6 max-w-7xl w-full overflow-hidden">
        <div className="border-l border-white/20 pl-8 md:pl-16 py-4 overflow-hidden">
          <motion.div initial={false} animate={{ opacity: 1, x: 0 }}>
            <h2 className="text-xs md:text-sm font-mono tracking-[0.3em] text-neutral-400 mb-6 uppercase">
              ThabangVision
            </h2>
          </motion.div>

          <motion.h1
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl sm:text-5xl md:text-8xl font-display font-medium text-white tracking-tighter leading-[0.9] mb-8 uppercase max-w-full break-words"
          >
            Book South Africa&apos;s <br />
            <span className="text-neutral-400">Best Creators And Gear.</span>
          </motion.h1>

          <motion.div initial={false} animate={{ opacity: 1 }} className="max-w-xl">
            <p className="text-lg text-neutral-300 font-light leading-relaxed mb-10">
              Find photographers, videographers, production crews, and professional gear. All in one trusted platform.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/studio/category/photography" className="group inline-flex items-center gap-2 min-h-[44px] bg-white text-black px-8 py-4 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity">
                Hire a Photographer <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link href="/rentals" className="group inline-flex items-center gap-2 min-h-[44px] border border-white/20 text-white px-8 py-4 text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-white/5 transition-colors">
                Rent Equipment <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-6">
              <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-widest">Verified Creators</span>
              <span className="text-neutral-400 text-[10px]">•</span>
              <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-widest">Secure Payments</span>
              <span className="text-neutral-400 text-[10px]">•</span>
              <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-widest">Refundable Deposits</span>
            </div>
          </motion.div>
        </div>
      </motion.div>

      <motion.div style={{ opacity }} className="absolute bottom-10 right-10 text-right z-20 hidden md:block">
        <div className="text-[10px] font-mono text-[#D4A843]">{STUDIO.location.city}, {STUDIO.location.country}</div>
      </motion.div>
    </div>
  );
};

// ─── How It Works ────────────────────────────────────────────────────────────

const HowItWorks = () => {
  const steps = [
    { icon: Search, title: 'Browse', description: 'Find verified creators and professional gear for your project.' },
    { icon: Calendar, title: 'Book', description: 'Pick your dates, describe your shoot, and lock it in.' },
    { icon: CreditCard, title: 'Pay', description: 'Secure online payment. No hidden fees, transparent pricing.' },
    { icon: Sparkles, title: 'Create', description: 'Your creator arrives, the gear is ready. Make something amazing.' },
  ];

  return (
    <section className="py-24 bg-[#050505] border-t border-white/5">
      <div className="container mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="text-[10px] font-mono text-accent uppercase tracking-widest mb-4 block">03 // Process</span>
          <h2 className="text-4xl md:text-5xl font-display font-medium text-white uppercase">
            How It <span className="text-neutral-400">Works</span>
          </h2>
          <p className="text-neutral-400 font-light leading-relaxed mt-4 max-w-2xl mx-auto">
            One place to book crew and gear. You book and pay ThabangVision, and we supply the creators and equipment your production needs.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 md:grid-cols-4 gap-6">
          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="relative bg-[#0A0A0B] border border-white/5 p-8 text-center hover:border-white/20 transition-colors"
            >
              <div className="text-[10px] font-mono text-neutral-400 mb-4">0{index + 1}</div>
              <step.icon className="w-8 h-8 text-accent mx-auto mb-4" />
              <h3 className="text-lg font-display font-medium text-white uppercase mb-2">{step.title}</h3>
              <p className="text-sm font-mono text-neutral-400 leading-relaxed">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ─── Community Section ───────────────────────────────────────────────────────

const CommunitySection = () => (
  <section className="py-32 bg-[#050505] border-t border-white/5 transition-colors duration-500">
    <div className="container mx-auto px-6">
      <div className="flex flex-col md:flex-row justify-between items-end mb-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="text-[10px] font-mono text-accent uppercase tracking-widest mb-4 block">06 // Community</span>
          <h2 className="text-4xl md:text-5xl font-display font-medium text-white uppercase">
            For <span className="text-neutral-400">Creators</span>
          </h2>
        </motion.div>
        <Link href="/rentals" className="hidden md:flex items-center gap-2 text-xs font-mono text-neutral-400 hover:text-white transition-colors uppercase tracking-widest mt-6 md:mt-0">
          Browse All Gear <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {[
          {
            icon: Camera,
            title: 'Supply Your Gear',
            description: 'Become a verified supplier. Put your camera, lenses, lighting and audio gear to work between your own jobs.',
            cta: 'Get Verified',
            href: '/dashboard/verification',
          },
          {
            icon: Calendar,
            title: 'Book Equipment',
            description: 'Reserve professional gear from our catalog or community listings. Live availability, and the full price before you pay.',
            cta: 'View Rentals',
            href: '/rentals',
          },
          {
            icon: Users,
            title: 'Join the Community',
            description: 'Create your profile, showcase your portfolio, and connect with South African creatives.',
            cta: 'Create Account',
            href: '/register',
          },
        ].map((item, index) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.1 }}
          >
            <Link href={item.href} className="group block h-full">
              <div className="h-full bg-[#0A0A0B] border border-white/5 p-8 hover:border-white/20 transition-all">
                <item.icon className="w-6 h-6 text-neutral-400 mb-6 group-hover:text-white transition-colors" />
                <h3 className="text-lg font-display font-medium uppercase text-white mb-3">
                  {item.title}
                </h3>
                <p className="text-sm font-mono text-neutral-400 leading-relaxed mb-6">
                  {item.description}
                </p>
                <span className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-white group-hover:translate-x-1 transition-transform">
                  {item.cta} <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

// ─── Booking CTA ─────────────────────────────────────────────────────────────

/**
 * `minDayRate` is the cheapest live day rate, read from stock rather than
 * typed in. The tile used to read a hardcoded "R500" while the real floor was
 * R20, which told every customer shopping under R500 to go elsewhere.
 * `null` means no priced stock is live, so the tile falls back to the label.
 */
const BookingCTA = ({ minDayRate }: { minDayRate: number | null }) => (
  <section className="py-24 bg-[#080808] border-t border-white/5 transition-colors duration-500">
    <div className="container mx-auto px-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
        >
          <span className="text-[10px] font-mono text-accent uppercase tracking-widest mb-4 block">05 // Rentals</span>
          <h2 className="text-4xl md:text-5xl font-display font-medium text-white tracking-tighter uppercase mb-6 leading-[0.95]">
            Book <br />
            <span className="text-neutral-400">Professional Gear</span>
          </h2>
          <p className="text-neutral-400 font-light leading-relaxed mb-8 max-w-md">
            From cinema cameras to lighting kits. See live availability and the full price before you pay, then book online.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href="/rentals" className="inline-flex items-center gap-2 min-h-[44px] bg-white text-black px-8 py-4 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity">
              Browse Equipment <ArrowRight className="w-3 h-3" />
            </Link>
            <Link href="/register" className="inline-flex items-center gap-2 min-h-[44px] border border-white/20 text-white px-8 py-4 text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-white/5 transition-colors">
              Create Account
            </Link>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          className="grid grid-cols-2 gap-4"
        >
          {[
            { label: 'Categories', value: '6+' },
            {
              label: minDayRate === null ? 'Day Rates' : 'Day Rates From',
              value: minDayRate === null ? 'On Request' : formatZAR(minDayRate),
            },
            { label: 'Online Booking', value: 'Yes' },
            { label: 'Deposit Protection', value: 'Secured' },
          ].map(stat => (
            <div key={stat.label} className="bg-[#0A0A0B] border border-white/5 p-6">
              <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 mb-2">
                {stat.label}
              </p>
              <p className="text-2xl font-display font-medium text-white">
                {stat.value}
              </p>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  </section>
);

// ─── Trust Signals ───────────────────────────────────────────────────────────

const TrustSignals = () => (
  <section className="py-16 bg-[#050505] border-t border-white/5">
    <div className="container mx-auto px-6">
      <div className="text-center mb-8">
        <span className="text-[10px] font-mono text-accent uppercase tracking-widest">02 // Trust &amp; Security</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {[
          { icon: BadgeCheck, label: 'Identity-Verified Creators', detail: 'Every creator passes ID verification' },
          { icon: Lock, label: 'Secure Payments', detail: 'Encrypted checkout, cards never stored' },
          { icon: ShieldCheck, label: 'Deposit Protection', detail: 'Refunded after the gear comes back undamaged' },
          { icon: Star, label: 'Rated & Reviewed', detail: 'Real reviews from real clients' },
        ].map((item) => (
          <div key={item.label} className="text-center p-4">
            <item.icon className="w-6 h-6 text-accent mx-auto mb-3" />
            <p className="text-sm font-display font-medium text-white uppercase mb-1">{item.label}</p>
            <p className="text-[11px] font-mono text-neutral-400">{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

// ─── Ubunye AI Section ───────────────────────────────────────────────────────

const UbunyeSection = () => (
  <section className="py-24 bg-[#050505] border-t border-white/5">
    <div className="container mx-auto px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="max-w-2xl mx-auto text-center"
      >
        <span className="text-[10px] font-mono text-accent uppercase tracking-widest mb-4 block">07 // AI Assistant</span>
        <MessageCircle className="w-10 h-10 text-accent mx-auto mb-6" />
        <h2 className="text-3xl md:text-4xl font-display font-medium text-white uppercase mb-4">
          Need Help <span className="text-neutral-400">Deciding?</span>
        </h2>
        <p className="text-neutral-400 font-light leading-relaxed mb-8">
          Ask Ubunye — our AI assistant finds the right creator and gear for your project.
        </p>
        <Link
          href="/ubunye-ai-studio"
          className="group inline-flex items-center gap-2 min-h-[44px] border border-accent/30 text-accent px-8 py-4 text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-accent/10 transition-colors"
        >
          Ask Ubunye <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </Link>
      </motion.div>
    </div>
  </section>
);

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function HomeClient({
  carouselItems,
  capabilities,
  minDayRate,
}: {
  carouselItems: CarouselItem[];
  capabilities: readonly Capability[];
  /** Cheapest live day rate, or null when no priced stock is published. */
  minDayRate: number | null;
}) {
  return (
    <div className="min-h-screen bg-[#050505] transition-colors duration-500">
      {/* 1. Hero */}
      <Hero />
      {/* 2. Showcase — gear and work, alternating.
          Sits directly under the hero because hire is the primary business and
          it previously appeared only as four tiles of text, five sections down.
          A visitor should see what there is to rent without hunting for it. */}
      <LatestWorkCarousel items={carouselItems} />
      {/* 3. Trust & Security */}
      <TrustSignals />
      {/* 4. How It Works */}
      <HowItWorks />
      {/* 5. What We Offer */}
      <ServiceGrid capabilities={capabilities} />
      {/* 6. Smart Rentals */}
      <BookingCTA minDayRate={minDayRate} />
      {/* 7. For Creators */}
      <CommunitySection />
      {/* 8. Ubunye AI */}
      <UbunyeSection />
      {/* 9. Final CTA */}
      <section className="py-40 relative bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950 overflow-hidden border-t border-white/5 transition-colors duration-500">
        <div className="container mx-auto px-6 relative z-10 text-center">
          <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-widest mb-6 block">08 // Get Started</span>
          <h2 className="text-5xl md:text-8xl font-display font-medium text-white tracking-tighter mb-12 uppercase">
            Ready To <br /> Create?
          </h2>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/contact" className="inline-flex items-center justify-center min-h-[44px] bg-white text-black px-12 py-5 text-xs font-mono font-bold tracking-[0.2em] transition-all uppercase hover:opacity-80">
              Start a Project
            </Link>
            <Link href="/rentals" className="inline-flex items-center justify-center min-h-[44px] border border-white/20 hover:bg-white/5 text-white px-12 py-5 text-xs font-mono font-bold tracking-[0.2em] transition-all uppercase">
              Browse Gear
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
