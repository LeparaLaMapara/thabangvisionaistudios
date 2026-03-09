'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion, useMotionValue, animate } from 'framer-motion';
import { ChevronLeft, ChevronRight, Clapperboard, Package, Newspaper } from 'lucide-react';
import { STUDIO } from '@/lib/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CarouselItem = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  tags: string[];
  category: 'production' | 'rental' | 'press';
  meta: string;
  categorySlug?: string;
  created_at: string;
};

const CATEGORY_CONFIG = {
  production: {
    label: 'Production',
    icon: Clapperboard,
    href: (slug: string, _categorySlug?: string) => `/smart-production/${slug}`,
  },
  rental: {
    label: 'Rental',
    icon: Package,
    href: (slug: string, categorySlug?: string) => `/smart-rentals/${categorySlug || 'cameras-optics'}/${slug}`,
  },
  press: {
    label: 'Press',
    icon: Newspaper,
    href: (_slug: string, _categorySlug?: string) => `/press`,
  },
} as const;

const PLACEHOLDER_ITEMS: CarouselItem[] = [
  {
    id: 'ph-1', slug: '', title: 'Your First Production',
    description: 'Featured productions, rentals, and press will appear here once published.',
    thumbnail_url: null, video_url: null, tags: ['Coming Soon'],
    category: 'production', meta: STUDIO.shortName, created_at: new Date().toISOString(),
  },
  {
    id: 'ph-2', slug: '', title: 'Equipment Spotlight',
    description: 'Feature your best rental gear here by marking it as featured in the admin panel.',
    thumbnail_url: null, video_url: null, tags: ['Coming Soon'],
    category: 'rental', meta: 'Smart Rentals', created_at: new Date().toISOString(),
  },
  {
    id: 'ph-3', slug: '', title: 'Latest News',
    description: 'Press articles marked as featured will rotate through this carousel.',
    thumbnail_url: null, video_url: null, tags: ['Coming Soon'],
    category: 'press', meta: 'Newsroom', created_at: new Date().toISOString(),
  },
];

// ─── Constants ───────────────────────────────────────────────────────────────

const GAP = 32;              // gap-8 = 2rem
const LOOP_DURATION = 30;    // seconds to scroll one full set of cards
const ARROW_PAUSE_MS = 3000; // pause auto-scroll 3s after arrow/dot click

// ─── Component ────────────────────────────────────────────────────────────────

export function LatestWorkCarousel({ items }: { items: CarouselItem[] }) {
  const displayItems = items.length > 0 ? items : PLACEHOLDER_ITEMS;
  const isPlaceholder = items.length === 0;
  const totalCards = displayItems.length;

  // 3x duplication — when set 1 scrolls off-screen, set 2 is identical,
  // so resetting translateX to 0 is visually invisible.
  const loopedItems = [...displayItems, ...displayItems, ...displayItems];

  const x = useMotionValue(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Refs for animation control
  const animRef = useRef<ReturnType<typeof animate> | null>(null);
  const arrowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const cardStrideRef = useRef(632);
  const setWidthRef = useRef(0);
  const lastDotRef = useRef(0);

  // Touch tracking
  const touchStartClientX = useRef(0);
  const touchStartValX = useRef(0);
  const isTouching = useRef(false);

  // ── Measure card dimensions ───────────────────────────────────────────────

  const measure = useCallback(() => {
    if (!trackRef.current?.children[0]) return;
    const cardW = (trackRef.current.children[0] as HTMLElement).offsetWidth;
    cardStrideRef.current = cardW + GAP;
    setWidthRef.current = totalCards * cardStrideRef.current;
  }, [totalCards]);

  // ── Start the infinite conveyor belt ──────────────────────────────────────
  //    Uses framer-motion's `animate()` — linear easing, constant speed.
  //    On completion, resets x to 0 (seamless because content is 3x duplicated)
  //    and immediately starts the next loop.

  const startLoop = useCallback(() => {
    if (!mountedRef.current || isPlaceholder) return;
    const sw = setWidthRef.current;
    if (sw <= 0) return;

    // Stop any running animation
    animRef.current?.stop();

    // Current position
    let current = x.get();

    // Normalize into the [0, -sw) range so the loop reset is clean
    if (current <= -sw) current += sw;
    if (current > 0) current -= sw;
    x.set(current);

    // How far remains until one full set has scrolled off?
    const remaining = sw + current; // current is negative, so this is (sw - |current|)
    // Duration proportional to remaining distance (maintains constant speed)
    const duration = (remaining / sw) * LOOP_DURATION;

    animRef.current = animate(x, current - remaining, {
      duration: Math.max(duration, 0.1),
      ease: 'linear',
      onComplete: () => {
        if (!mountedRef.current) return;
        // Snap back — visually invisible because set 2 is identical to set 1
        x.set(0);
        startLoop();
      },
    });
  }, [x, isPlaceholder]);

  const stopLoop = useCallback(() => {
    animRef.current?.stop();
  }, []);

  // ── Mount: measure → start ────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    const raf = requestAnimationFrame(() => {
      measure();
      startLoop();
    });
    window.addEventListener('resize', measure);
    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      animRef.current?.stop();
      if (arrowTimerRef.current) clearTimeout(arrowTimerRef.current);
    };
  }, [measure, startLoop]);

  // ── Track active dot index ────────────────────────────────────────────────

  useEffect(() => {
    return x.on('change', (val) => {
      const sw = setWidthRef.current;
      const stride = cardStrideRef.current;
      if (sw <= 0 || stride <= 0) return;
      const pos = (((-val) % sw) + sw) % sw;
      const idx = Math.round(pos / stride) % totalCards;
      if (idx !== lastDotRef.current) {
        lastDotRef.current = idx;
        setActiveIndex(idx);
      }
    });
  }, [x, totalCards]);

  // ── Hover: stop on enter, resume on leave ─────────────────────────────────

  const onMouseEnter = useCallback(() => {
    if (isTouching.current) return; // don't interfere with touch
    stopLoop();
  }, [stopLoop]);

  const onMouseLeave = useCallback(() => {
    if (isTouching.current) return;
    startLoop();
  }, [startLoop]);

  // ── Arrow navigation ──────────────────────────────────────────────────────

  const scrollTo = useCallback((direction: 'left' | 'right') => {
    stopLoop();
    const stride = cardStrideRef.current;
    x.set(x.get() + (direction === 'right' ? -stride : stride));

    // Resume auto-scroll after 3s
    if (arrowTimerRef.current) clearTimeout(arrowTimerRef.current);
    arrowTimerRef.current = setTimeout(() => startLoop(), ARROW_PAUSE_MS);
  }, [x, stopLoop, startLoop]);

  // ── Dot navigation ────────────────────────────────────────────────────────

  const scrollToIndex = useCallback((idx: number) => {
    stopLoop();
    const sw = setWidthRef.current;
    const stride = cardStrideRef.current;
    if (sw <= 0) return;

    // Jump to the position of this card within the current set
    const currentPos = -x.get();
    const currentSet = Math.floor(currentPos / sw);
    x.set(-(currentSet * sw + idx * stride));

    if (arrowTimerRef.current) clearTimeout(arrowTimerRef.current);
    arrowTimerRef.current = setTimeout(() => startLoop(), ARROW_PAUSE_MS);
  }, [x, stopLoop, startLoop]);

  // ── Touch / swipe ─────────────────────────────────────────────────────────

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    isTouching.current = true;
    stopLoop();
    touchStartClientX.current = e.touches[0].clientX;
    touchStartValX.current = x.get();
  }, [x, stopLoop]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isTouching.current) return;
    const dx = touchStartClientX.current - e.touches[0].clientX;
    x.set(touchStartValX.current - dx);
  }, [x]);

  const onTouchEnd = useCallback(() => {
    isTouching.current = false;
    startLoop();
  }, [startLoop]);

  return (
    <section className="py-32 bg-neutral-50 dark:bg-[#050505] transition-colors duration-500">
      {/* Header */}
      <div className="container mx-auto px-6 mb-16 flex justify-between items-end">
        <div>
          <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">
            01 // Selected Works
          </span>
          <h2 className="text-4xl md:text-5xl font-display font-medium text-black dark:text-white uppercase">
            Latest Work
          </h2>
        </div>
        <div className="hidden md:flex items-center gap-6">
          <Link
            href="/archive"
            className="flex items-center gap-2 text-xs font-mono text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white transition-colors uppercase tracking-widest"
          >
            View Archive <ChevronRight className="w-4 h-4" />
          </Link>
          <div className="flex gap-2">
            <button
              onClick={() => scrollTo('left')}
              className="w-10 h-10 border border-black/10 dark:border-white/10 flex items-center justify-center hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-all"
              aria-label="Scroll left"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => scrollTo('right')}
              className="w-10 h-10 border border-black/10 dark:border-white/10 flex items-center justify-center hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-all"
              aria-label="Scroll right"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Carousel */}
      <div
        className="relative overflow-hidden"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <motion.div
          ref={trackRef}
          style={{ x }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="flex gap-8 pl-6 will-change-transform"
        >
          {loopedItems.map((item, index) => (
            <CarouselCard
              key={`${item.id}-set${Math.floor(index / totalCards)}`}
              item={item}
              isPlaceholder={isPlaceholder}
            />
          ))}
        </motion.div>
      </div>

      {/* Dot indicators */}
      <div className="flex justify-center gap-2 mt-8 px-6">
        {displayItems.map((item, idx) => (
          <button
            key={item.id}
            onClick={() => scrollToIndex(idx)}
            aria-label={`Go to slide ${idx + 1}`}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              idx === activeIndex
                ? 'w-8 bg-black dark:bg-white'
                : 'w-1.5 bg-black/20 dark:bg-white/20 hover:bg-black/40 dark:hover:bg-white/40'
            }`}
          />
        ))}
      </div>

      {/* Mobile archive link */}
      <div className="md:hidden flex justify-center mt-8">
        <Link
          href="/archive"
          className="flex items-center gap-2 text-xs font-mono text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white transition-colors uppercase tracking-widest"
        >
          View Archive <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </section>
  );
}

// ─── Card Component ──────────────────────────────────────────────────────────

function CarouselCard({
  item,
  isPlaceholder,
}: {
  item: CarouselItem;
  isPlaceholder: boolean;
}) {
  const config = CATEGORY_CONFIG[item.category];
  const Icon = config.icon;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const isDirectVideo = item.video_url && (
    item.video_url.endsWith('.mp4') ||
    item.video_url.endsWith('.webm') ||
    item.video_url.includes('cloudinary.com')
  );

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (isDirectVideo && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  const cardContent = (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="group cursor-pointer flex-shrink-0 w-[85vw] md:w-[600px]"
    >
      <div className="relative overflow-hidden mb-6 bg-neutral-200 dark:bg-neutral-900 border border-black/5 dark:border-white/10 w-full h-[55vw] md:h-[340px]">
        <div className="absolute top-4 left-4 z-30 flex gap-2">
          <span className="flex items-center gap-1.5 text-[9px] font-mono bg-white/90 dark:bg-black/80 text-black dark:text-white border border-black/10 dark:border-white/20 px-2 py-1 uppercase tracking-wider backdrop-blur-md">
            <Icon className="w-2.5 h-2.5" />
            {config.label}
          </span>
          {item.tags.slice(0, 2).map(tag => (
            <span
              key={tag}
              className="text-[9px] font-mono bg-white/90 dark:bg-black/80 text-black dark:text-white border border-black/10 dark:border-white/20 px-2 py-1 uppercase tracking-wider backdrop-blur-md"
            >
              {tag}
            </span>
          ))}
        </div>

        {item.thumbnail_url ? (
          <>
            <Image
              src={item.thumbnail_url}
              alt={item.title}
              fill
              sizes="(max-width: 768px) 85vw, 600px"
              className={`object-cover transition-all duration-700 ${
                isHovered && isDirectVideo
                  ? 'opacity-0'
                  : 'opacity-90 dark:opacity-80 group-hover:opacity-100 group-hover:scale-105'
              }`}
            />
            {isDirectVideo && (
              <video
                ref={videoRef}
                src={item.video_url!}
                muted
                playsInline
                loop
                preload="none"
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
                  isHovered ? 'opacity-100' : 'opacity-0'
                }`}
              />
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-neutral-900 dark:to-neutral-800">
            <Icon className="w-12 h-12 text-neutral-300 dark:text-neutral-700" />
          </div>
        )}
      </div>

      <div className="border-b border-black/10 dark:border-white/10 pb-4">
        <h3 className="text-xl md:text-2xl font-display text-black dark:text-white uppercase mb-1 truncate">
          {item.title}
        </h3>
        <p className="text-sm font-mono text-neutral-500">{item.meta}</p>
        {item.description && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2 line-clamp-2">
            {item.description}
          </p>
        )}
      </div>
    </div>
  );

  if (isPlaceholder || !item.slug) {
    return cardContent;
  }

  return (
    <Link href={config.href(item.slug, item.categorySlug)} className="contents">
      {cardContent}
    </Link>
  );
}
