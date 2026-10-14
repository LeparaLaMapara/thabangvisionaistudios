'use client';

import { useEffect, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import { ServiceGrid } from '@/components/cinematic/ServiceGrid';
import { LatestWorkCarousel, type CarouselItem } from '@/components/cinematic/LatestWorkCarousel';
import { ArrowRight, Calendar, Search, MapPin, RotateCcw, MessageCircle, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import { STUDIO, UBUNYE_STUDIO, CREATOR_JOIN, EARN } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';
import { PaymentsNotOpenNote } from '@/components/booking/PaymentsNotOpenNote';

import { collectionPoint } from '@/lib/rental/collection-point';

/** Where gear is collected (the area only): "Dainfern, Fourways". */
const COLLECTION_POINT = collectionPoint();

// ─── Hero ────────────────────────────────────────────────────────────────────

const Hero = ({ minDayRate }: { minDayRate: number | null }) => {
  const { scrollY } = useScroll();
  const y1 = useTransform(scrollY, [0, 500], [0, 200]);
  const opacity = useTransform(scrollY, [0, 300], [1, 0]);
  const { hero } = STUDIO;
  const useVideo = hero.type === 'video' && !!hero.videoSrc;
  // The hero is the video, on every screen. The headline is plain text and
  // shows at once; the video starts once the page is interactive. Phones get
  // the 720px version. People who asked their phone to save data or reduce
  // motion see the logo instead. (The still picture was removed at the
  // owner's request, 2026-09-28.)
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  useEffect(() => {
    if (!useVideo) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (calm || saveData) return;
    const phone = window.matchMedia('(max-width: 767px)').matches;
    const src = phone && hero.mobileVideoSrc ? hero.mobileVideoSrc : hero.videoSrc;
    // Start as soon as the page is interactive: with no picture to show first,
    // the video is what the hero is for.
    const id = window.setTimeout(() => setVideoSrc(src), 0);
    return () => window.clearTimeout(id);
  }, [useVideo, hero.mobileVideoSrc, hero.videoSrc]);
  const filterClass = hero.colorMode === 'bw' ? 'grayscale contrast-125' : 'contrast-110 saturate-[0.85]';

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#050505] flex items-center justify-center transition-colors duration-500">
      <motion.div style={{ y: y1 }} className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-[#050505]/50 z-10" />

        {/* The logo holds the space until the video plays, then fades out.
            It stays for people whose phone asks to save data or reduce motion. */}
        <div
          aria-hidden="true"
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-1000 ${videoPlaying ? 'opacity-0' : 'opacity-100'}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-hero-480.webp" alt="" width={428} height={480} className="w-40 md:w-64 h-auto opacity-15" />
        </div>
        {videoSrc && (
          <video
            src={videoSrc}
            autoPlay
            loop
            muted
            playsInline
            aria-hidden="true"
            onPlaying={() => setVideoPlaying(true)}
            className={`absolute inset-0 w-full h-full object-cover ${filterClass} transition-opacity duration-1000 ${videoPlaying ? 'opacity-40' : 'opacity-0'}`}
          />
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
            Rent Camera Gear <br />
            <span className="text-neutral-400">In {STUDIO.location.city}.</span>
          </motion.h1>

          <motion.div initial={false} animate={{ opacity: 1 }} className="max-w-xl">
            <p className="text-lg text-neutral-300 font-light leading-relaxed mb-10">
              Cameras, lenses, lights, sound and drones{minDayRate !== null ? ` from ${formatRand(minDayRate)} a day` : ''}. Book online and collect at {COLLECTION_POINT}.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
              <Link href="/rentals" className="group inline-flex items-center gap-2 min-h-[44px] bg-white text-black px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity">
                Browse Gear <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link href="/contact?type=production_brief" className="inline-flex items-center min-h-[44px] text-sm text-neutral-300 underline underline-offset-4 decoration-white/30 hover:text-white hover:decoration-white transition-colors">
                Need a photographer? Send us a brief
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-6">
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">Free To Join</span>
              <span className="text-neutral-400 text-xs">•</span>
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">Pay Only When You Book</span>
              <span className="text-neutral-400 text-xs">•</span>
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">Refundable Deposit</span>
            </div>
          </motion.div>
        </div>
      </motion.div>

      <motion.div style={{ opacity }} className="absolute bottom-10 right-10 text-right z-20 hidden md:block">
        <div className="text-xs font-mono text-[#D4A843]">{STUDIO.location.city}, {STUDIO.location.country}</div>
      </motion.div>
    </div>
  );
};

// ─── How It Works ────────────────────────────────────────────────────────────

/**
 * Four steps for renting gear, the one thing a visitor can do today. Step two
 * follows the payment switch: while online payment is closed it says we
 * contact you to arrange payment, and the notice under the steps says how.
 */
const HowItWorks = ({ paymentsOpen }: { paymentsOpen: boolean }) => {
  const steps = [
    { icon: Search, title: 'Pick', description: 'Pick your gear and dates.' },
    {
      icon: Calendar,
      title: 'Book',
      description: paymentsOpen
        ? 'Book online and pay by card.'
        : `Book online, then pay by EFT within ${STUDIO.bank.payWithinHours} hours, or in cash when you collect.`,
    },
    { icon: MapPin, title: 'Collect', description: `Collect at ${COLLECTION_POINT}. Bring your ID the first time.` },
    { icon: RotateCcw, title: 'Return', description: 'Return it on time and get your deposit back.' },
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
          <h2 className="text-4xl md:text-5xl font-display font-medium text-white uppercase">
            How It <span className="text-neutral-400">Works</span>
          </h2>
          <p className="text-neutral-400 font-light leading-relaxed mt-4 max-w-2xl mx-auto">
            You rent straight from {STUDIO.name}. All the gear is ours.
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
              <div className="text-xs font-mono text-neutral-400 mb-4">{index + 1}</div>
              <step.icon className="w-8 h-8 text-accent mx-auto mb-4" />
              <h3 className="text-lg font-display font-medium text-white uppercase mb-2">{step.title}</h3>
              <p className="text-sm font-mono text-neutral-400 leading-relaxed">{step.description}</p>
            </motion.div>
          ))}
        </div>
        <PaymentsNotOpenNote open={paymentsOpen} className="justify-center text-center mt-10 max-w-2xl mx-auto" />
      </div>
    </section>
  );
};

// ─── Booking CTA ─────────────────────────────────────────────────────────────

/**
 * The rentals block. It used to carry four stat tiles ("Categories 6+",
 * "Online booking Yes", "Deposit protection Secured") that said little, and
 * "from cinema cameras" when no cinema camera is in stock. The cheapest day
 * rate now sits in the hero line, read from stock.
 */
const BookingCTA = () => (
  <section className="py-24 bg-[#080808] border-t border-white/5 transition-colors duration-500">
    <div className="container mx-auto px-6">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        className="max-w-2xl"
      >
        <h2 className="text-4xl md:text-5xl font-display font-medium text-white tracking-tighter uppercase mb-6 leading-[0.95]">
          Book <br />
          <span className="text-neutral-400">Professional Gear</span>
        </h2>
        <p className="text-neutral-400 font-light leading-relaxed mb-8 max-w-md">
          From mirrorless cameras to lighting kits. See live availability and the full price before you book.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link href="/rentals" className="inline-flex items-center gap-2 min-h-[44px] bg-white text-black px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity">
            Browse Equipment <ArrowRight className="w-3 h-3" />
          </Link>
          <Link href="/register" className="inline-flex items-center gap-2 min-h-[44px] border border-white/20 text-white px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:bg-white/5 transition-colors">
            Create Account
          </Link>
        </div>
      </motion.div>
    </div>
  </section>
);

// ─── Creator Join ────────────────────────────────────────────────────────────
// The creator's way in, now that it is not in the header (see CREATOR_JOIN).

const CreatorJoin = ({ earn }: { earn: boolean }) => (
  <section className="py-24 bg-[#050505] border-t border-white/5">
    <div className="container mx-auto px-6">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        className="max-w-2xl"
      >
        <span className="text-xs font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-4 block">For Creators</span>
        <h2 className="text-4xl md:text-5xl font-display font-medium text-white tracking-tighter uppercase mb-6 leading-[0.95]">
          {earn ? EARN.homeTitle : CREATOR_JOIN.homeTitle}
        </h2>
        <p className="text-neutral-400 font-light leading-relaxed mb-8 max-w-md">
          {earn ? EARN.homeText : CREATOR_JOIN.homeText}
        </p>
        <Link href={earn ? EARN.href : CREATOR_JOIN.href} className="inline-flex items-center gap-2 min-h-[44px] bg-[#D4A843] text-black px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity">
          {earn ? EARN.label : CREATOR_JOIN.ctaLabel} <ArrowRight className="w-3 h-3" />
        </Link>
      </motion.div>
    </div>
  </section>
);

// ─── Trust Signals ───────────────────────────────────────────────────────────

/**
 * Only what is true today. "Identity-verified creators", "Secure payments"
 * and "Rated & reviewed" were removed (2026-09-28): there are no creators
 * listed, online payment is not open and there are no reviews yet. Put them
 * back when they are true. The deposit timing is the one on /refunds.
 */
const TrustSignals = () => (
  <section className="py-16 bg-[#050505] border-t border-white/5">
    <div className="container mx-auto px-6">
      <div className="max-w-md mx-auto text-center p-4">
        <ShieldCheck className="w-6 h-6 text-accent mx-auto mb-3" />
        <p className="text-sm font-display font-medium text-white uppercase mb-1">Refundable Deposit</p>
        <p className="text-xs font-mono text-neutral-400">
          Paid back within 5 business days after the gear comes back in good condition.
        </p>
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
        <MessageCircle className="w-10 h-10 text-accent mx-auto mb-6" />
        <h2 className="text-3xl md:text-4xl font-display font-medium text-white uppercase mb-4">
          Need Help <span className="text-neutral-400">Deciding?</span>
        </h2>
        <p className="text-neutral-400 font-light leading-relaxed mb-8">
          Ask Ubunye, our AI assistant, about gear, dates and prices.
        </p>
        <Link
          href="/ubunye-ai-studio"
          className="group inline-flex items-center gap-2 min-h-[44px] border border-accent/30 text-accent px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:bg-accent/10 transition-colors"
        >
          Ask Ubunye <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </Link>
      </motion.div>
    </div>
  </section>
);

// ─── Ubunye Apps ─────────────────────────────────────────────────────────────

/**
 * The free apps, in one strip. Shown with the "Apps" nav item (creative_tools
 * flag). Each icon opens that app's page; the button opens all three.
 */
const AppsStrip = () => (
  <section className="py-24 bg-[#080808] border-t border-white/5">
    <div className="container mx-auto px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="max-w-3xl mx-auto text-center"
      >
        <h2 className="text-4xl md:text-5xl font-display font-medium text-white uppercase">
          Free Apps <span className="text-neutral-400">For Creators</span>
        </h2>
        <p className="text-neutral-400 font-light leading-relaxed mt-4 mb-10 max-w-xl mx-auto">
          {UBUNYE_STUDIO.intro}
        </p>
        <ul className="grid grid-cols-3 gap-4 sm:gap-8 max-w-md mx-auto mb-10">
          {UBUNYE_STUDIO.apps.map((app) => (
            <li key={app.slug}>
              <Link href={`/tools/${app.slug}`} className="group flex flex-col items-center gap-3 min-h-[44px]">
                <Image
                  src={app.iconPng}
                  alt=""
                  width={80}
                  height={80}
                  unoptimized
                  className="h-16 w-16 sm:h-20 sm:w-20 transition-transform group-hover:scale-105"
                />
                <span className="text-sm text-white">{app.shortName}</span>
                <span className="text-xs font-mono text-neutral-400 leading-snug">{app.category}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href="/tools"
          className="group inline-flex items-center gap-2 min-h-[44px] border border-white/20 text-white px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:bg-white/5 transition-colors"
        >
          Get The Free Apps <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </Link>
      </motion.div>
    </div>
  </section>
);

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * The home page leads with gear rental, the offering that is live (owner's
 * decision, 2026-09-28). Shoots are reached by one quiet link in the hero.
 * The "What we offer" grid and the supplier and community cards were removed:
 * no supplier listings or community features exist yet.
 */
export default function HomeClient({
  carouselItems,
  minDayRate,
  paymentsOpen,
  showApps = false,
  rolesOn = false,
}: {
  carouselItems: CarouselItem[];
  /** Cheapest live day rate, or null when no priced stock is published. */
  minDayRate: number | null;
  /** onlinePaymentsOpen() from the server. */
  paymentsOpen: boolean;
  /** The creative_tools flag: shows the free apps strip. */
  showApps?: boolean;
  /** roles_v1: the creator block becomes Earn with ThabangVision. */
  rolesOn?: boolean;
}) {
  return (
    <div className="min-h-screen bg-[#050505] transition-colors duration-500">
      <Hero minDayRate={minDayRate} />
      {/* Gear and recent shoots, directly under the hero. */}
      <LatestWorkCarousel items={carouselItems} />
      <HowItWorks paymentsOpen={paymentsOpen} />
      {/* What we offer: the Rentals and Studio cards (owner asked to keep them). */}
      <ServiceGrid />
      <TrustSignals />
      <BookingCTA />
      <CreatorJoin earn={rolesOn} />
      {showApps && <AppsStrip />}
      <UbunyeSection />
      {/* Final CTA */}
      <section className="py-40 relative bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950 overflow-hidden border-t border-white/5 transition-colors duration-500">
        <div className="container mx-auto px-6 relative z-10 text-center">
          <h2 className="text-5xl md:text-8xl font-display font-medium text-white tracking-tighter mb-12 uppercase">
            Ready To <br /> Rent?
          </h2>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/rentals" className="inline-flex items-center justify-center min-h-[44px] bg-white text-black px-12 py-5 text-xs font-mono font-bold tracking-[0.2em] transition-all uppercase hover:opacity-80">
              Browse Gear
            </Link>
            <Link href="/contact" className="inline-flex items-center justify-center min-h-[44px] border border-white/20 hover:bg-white/5 text-white px-12 py-5 text-xs font-mono font-bold tracking-[0.2em] transition-all uppercase">
              Contact Us
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
