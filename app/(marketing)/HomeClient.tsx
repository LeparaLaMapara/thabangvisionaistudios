'use client';

import { useEffect, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import { LatestWorkCarousel, type CarouselItem } from '@/components/cinematic/LatestWorkCarousel';
import { ArrowRight, Calendar, Search, MapPin, RotateCcw, ShieldCheck } from 'lucide-react';
import { STUDIO, EARN, HOME_PEOPLE } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';
import { PaymentsNotOpenNote } from '@/components/booking/PaymentsNotOpenNote';

import { collectionPoint } from '@/lib/rental/collection-point';

/** Where gear is collected (the area only): "Dainfern, Fourways". */
const COLLECTION_POINT = collectionPoint();

// ─── Hero ────────────────────────────────────────────────────────────────────

const Hero = ({ minDayRate, rolesOn, peopleLine }: { minDayRate: number | null; rolesOn: boolean; peopleLine: string }) => {
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
            {rolesOn ? (
              <>
                {HOME_PEOPLE.titleTop} <br />
                <span className="text-neutral-400">{HOME_PEOPLE.titleBottom}</span>
              </>
            ) : (
              <>
                Rent Camera Gear <br />
                <span className="text-neutral-400">In {STUDIO.location.city}.</span>
              </>
            )}
          </motion.h1>

          <motion.div initial={false} animate={{ opacity: 1 }} className="max-w-xl">
            <p className="text-lg text-neutral-300 font-light leading-relaxed mb-10">
              Cameras, lenses, lights, sound and drones{minDayRate !== null ? ` from ${formatRand(minDayRate)} a day` : ''}. Book online and collect at {COLLECTION_POINT}.
              {rolesOn && <> {peopleLine}</>}
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
              <Link href="/rentals" className="group inline-flex items-center gap-2 min-h-[44px] bg-white text-black px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity">
                {HOME_PEOPLE.rentLabel} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              {rolesOn ? (
                <Link href={HOME_PEOPLE.peopleHref} className="group inline-flex items-center gap-2 min-h-[44px] bg-[#D4A843] text-black px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity">
                  {HOME_PEOPLE.peopleLabel} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
              ) : (
                <Link href="/contact?type=production_brief" className="inline-flex items-center min-h-[44px] text-sm text-neutral-300 underline underline-offset-4 decoration-white/30 hover:text-white hover:decoration-white transition-colors">
                  Need a photographer? Send us a brief
                </Link>
              )}
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

// ─── People row ──────────────────────────────────────────────────────────────

export interface HomePersonCard {
  id: string;
  label: string;
  cover: string | null;
  price: string | null;
}

/** One row of people to book (roles_v1): blind cards, the same as /people. */
const PeopleRow = ({ cards }: { cards: HomePersonCard[] }) => (
  <section className="py-24 bg-[#050505] border-t border-white/5">
    <div className="container mx-auto px-6">
      <div className="mb-12 flex flex-wrap justify-between items-end gap-4">
        <h2 className="text-4xl md:text-5xl font-display font-medium text-white uppercase">People to book</h2>
        <Link
          href={HOME_PEOPLE.peopleHref}
          className="inline-flex items-center gap-2 min-h-[44px] text-xs font-mono text-neutral-400 hover:text-white transition-colors uppercase tracking-widest"
        >
          See everyone <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      <ul className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <li key={c.id}>
            <Link href={`/people/${c.id}`} className="group block border border-white/10 hover:border-accent-gold/60 transition-colors">
              <div className="aspect-[4/3] bg-neutral-900 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.cover && <img src={c.cover} alt="" className="w-full h-full object-cover" loading="lazy" />}
              </div>
              <div className="p-4">
                <p className="text-white">{c.label}</p>
                {c.price && <p className="text-sm text-neutral-300 mt-1">{c.price}</p>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  </section>
);

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * The home page, said once (clarity audit C14, owner 2026-10-15): the hero
 * (Rent gear / Book people), How it works, one gear row, one People row, the
 * trust line and one closing call to action. The Rentals/People tiles, the
 * "Book professional gear" block, the creator block, the apps strip and the
 * Ubunye block repeated the hero and the menu, so they are gone; Earn is one
 * quiet link under the closing call to action. With roles_v1 off there is no
 * People row and the hero keeps its "send us a brief" link.
 */
export default function HomeClient({
  carouselItems,
  peopleCards = [],
  minDayRate,
  paymentsOpen,
  rolesOn = false,
  people,
}: {
  /** Gear only: one gear row. */
  carouselItems: CarouselItem[];
  /** With People on: up to four blind cards for the one People row. */
  peopleCards?: HomePersonCard[];
  /** Cheapest live day rate, or null when no priced stock is published. */
  minDayRate: number | null;
  /** onlinePaymentsOpen() from the server. */
  paymentsOpen: boolean;
  /** roles_v1: the creator block becomes Earn with ThabangVision. */
  rolesOn?: boolean;
  /**
   * With People on: words naming only the kinds of work someone approved
   * offers (lib/roles/offered.ts peopleWords), read on the server.
   */
  people?: { heroLine: string; tileSubtitle: string; offerLine: string };
}) {
  return (
    <div className="min-h-screen bg-[#050505] transition-colors duration-500">
      <Hero minDayRate={minDayRate} rolesOn={rolesOn} peopleLine={people?.heroLine ?? HOME_PEOPLE.peopleLine} />
      <HowItWorks paymentsOpen={paymentsOpen} />
      {/* One gear row, one People row (clarity audit C14: no repeated blocks). */}
      <LatestWorkCarousel items={carouselItems} />
      {rolesOn && peopleCards.length > 0 && <PeopleRow cards={peopleCards} />}
      <TrustSignals />
      {/* Final CTA */}
      <section className="py-40 relative bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950 overflow-hidden border-t border-white/5 transition-colors duration-500">
        <div className="container mx-auto px-6 relative z-10 text-center">
          <h2 className="text-5xl md:text-8xl font-display font-medium text-white tracking-tighter mb-12 uppercase">
            {rolesOn ? HOME_PEOPLE.finalTitle : <>Ready To <br /> Rent?</>}
          </h2>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/rentals" className="inline-flex items-center justify-center min-h-[44px] bg-white text-black px-12 py-5 text-xs font-mono font-bold tracking-[0.2em] transition-all uppercase hover:opacity-80">
              {HOME_PEOPLE.rentLabel}
            </Link>
            {rolesOn ? (
              <Link href={HOME_PEOPLE.peopleHref} className="inline-flex items-center justify-center min-h-[44px] bg-[#D4A843] text-black px-12 py-5 text-xs font-mono font-bold tracking-[0.2em] transition-all uppercase hover:opacity-80">
                {HOME_PEOPLE.peopleLabel}
              </Link>
            ) : (
              <Link href="/contact" className="inline-flex items-center justify-center min-h-[44px] border border-white/20 hover:bg-white/5 text-white px-12 py-5 text-xs font-mono font-bold tracking-[0.2em] transition-all uppercase">
                Contact Us
              </Link>
            )}
          </div>
          <p className="mt-10 text-sm text-neutral-400">
            Want to earn with your skills or your gear?{' '}
            <Link href={EARN.href} className="inline-flex min-h-[44px] items-center text-[#D4A843] underline underline-offset-4">
              {EARN.label}
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
