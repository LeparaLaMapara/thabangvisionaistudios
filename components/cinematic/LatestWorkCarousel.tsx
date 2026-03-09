'use client';

import { useRef, useState, useEffect, useCallback, memo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
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
    href: (slug: string, _categorySlug?: string) => `/press/${slug}`,
  },
} as const;

const PLACEHOLDER_ITEMS: CarouselItem[] = [
  {
    id: 'ph-1', slug: '', title: 'Smart Productions',
    description: 'Cinematic storytelling powered by cutting-edge technology and South African creative talent.',
    thumbnail_url: null, video_url: null, tags: ['Film', 'Photography'],
    category: 'production', meta: STUDIO.shortName, created_at: new Date().toISOString(),
  },
  {
    id: 'ph-2', slug: '', title: 'Professional Gear',
    description: 'Cinema cameras, optics, lighting, audio, and grip equipment available for rent.',
    thumbnail_url: null, video_url: null, tags: ['Cameras', 'Lighting'],
    category: 'rental', meta: 'Smart Rentals', created_at: new Date().toISOString(),
  },
  {
    id: 'ph-3', slug: '', title: 'Studio News',
    description: 'Industry insights, project announcements, and behind-the-scenes features.',
    thumbnail_url: null, video_url: null, tags: ['Press'],
    category: 'press', meta: 'Newsroom', created_at: new Date().toISOString(),
  },
];

// ─── Constants ───────────────────────────────────────────────────────────────

const GAP = 32;
const SPEED = 0.5;            // pixels per frame (~30px/sec at 60fps)
const ARROW_PAUSE_MS = 4000;

// ─── Component ────────────────────────────────────────────────────────────────

export function LatestWorkCarousel({ items }: { items: CarouselItem[] }) {
  const displayItems = items.length > 0 ? items : PLACEHOLDER_ITEMS;
  const isPlaceholder = items.length === 0;
  const totalCards = displayItems.length;

  // 2x duplication for seamless loop
  const loopedItems = [...displayItems, ...displayItems];

  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Animation state — all in refs to avoid re-renders
  const offsetRef = useRef(0);
  const rafRef = useRef(0);
  const pausedRef = useRef(false);
  const strideRef = useRef(632);
  const setWidthRef = useRef(0);
  const arrowTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── Measure ─────────────────────────────────────────────────────────────────

  const measure = useCallback(() => {
    if (!trackRef.current?.children[0]) return;
    const cardW = (trackRef.current.children[0] as HTMLElement).offsetWidth;
    strideRef.current = cardW + GAP;
    setWidthRef.current = totalCards * strideRef.current;
  }, [totalCards]);

  // ── RAF loop — GPU-composited via translate3d ───────────────────────────────

  const tick = useCallback(() => {
    if (!pausedRef.current && !isPlaceholder) {
      offsetRef.current += SPEED;
      const sw = setWidthRef.current;
      if (sw > 0 && offsetRef.current >= sw) {
        offsetRef.current -= sw;
      }

      if (trackRef.current) {
        trackRef.current.style.transform = `translate3d(${-offsetRef.current}px, 0, 0)`;
      }

      // Update dot indicator (throttled — only when index changes)
      const stride = strideRef.current;
      if (stride > 0 && sw > 0) {
        const idx = Math.floor((offsetRef.current % sw) / stride) % totalCards;
        // Direct DOM compare avoids setState churn
        setActiveIndex(prev => prev === idx ? prev : idx);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [isPlaceholder, totalCards]);

  // ── Mount / unmount ─────────────────────────────────────────────────────────

  useEffect(() => {
    measure();
    rafRef.current = requestAnimationFrame(tick);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', measure);
      if (arrowTimerRef.current) clearTimeout(arrowTimerRef.current);
    };
  }, [measure, tick]);

  // ── Pause / resume ──────────────────────────────────────────────────────────

  const pause = useCallback(() => { pausedRef.current = true; }, []);
  const resume = useCallback(() => { pausedRef.current = false; }, []);

  // ── Arrow navigation — instant jump with smooth snap ────────────────────────

  const scrollTo = useCallback((direction: 'left' | 'right') => {
    pause();
    const stride = strideRef.current;
    const sw = setWidthRef.current;

    if (direction === 'right') {
      offsetRef.current += stride;
    } else {
      offsetRef.current -= stride;
    }

    // Keep in bounds
    if (sw > 0) {
      if (offsetRef.current < 0) offsetRef.current += sw;
      if (offsetRef.current >= sw) offsetRef.current -= sw;
    }

    if (trackRef.current) {
      trackRef.current.style.transform = `translate3d(${-offsetRef.current}px, 0, 0)`;
    }

    if (arrowTimerRef.current) clearTimeout(arrowTimerRef.current);
    arrowTimerRef.current = setTimeout(resume, ARROW_PAUSE_MS);
  }, [pause, resume]);

  // ── Dot navigation ──────────────────────────────────────────────────────────

  const scrollToIndex = useCallback((idx: number) => {
    pause();
    offsetRef.current = idx * strideRef.current;

    if (trackRef.current) {
      trackRef.current.style.transform = `translate3d(${-offsetRef.current}px, 0, 0)`;
    }

    if (arrowTimerRef.current) clearTimeout(arrowTimerRef.current);
    arrowTimerRef.current = setTimeout(resume, ARROW_PAUSE_MS);
  }, [pause, resume]);

  // ── Touch / swipe ───────────────────────────────────────────────────────────

  const touchStartX = useRef(0);
  const touchStartOffset = useRef(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    pause();
    touchStartX.current = e.touches[0].clientX;
    touchStartOffset.current = offsetRef.current;
  }, [pause]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = touchStartX.current - e.touches[0].clientX;
    offsetRef.current = touchStartOffset.current + dx;

    const sw = setWidthRef.current;
    if (sw > 0) {
      if (offsetRef.current < 0) offsetRef.current += sw;
      if (offsetRef.current >= sw) offsetRef.current -= sw;
    }

    if (trackRef.current) {
      trackRef.current.style.transform = `translate3d(${-offsetRef.current}px, 0, 0)`;
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (arrowTimerRef.current) clearTimeout(arrowTimerRef.current);
    arrowTimerRef.current = setTimeout(resume, ARROW_PAUSE_MS);
  }, [resume]);

  return (
    <section className="py-32 bg-neutral-50 dark:bg-[#050505] transition-colors duration-500">
      {/* Header */}
      <div className="container mx-auto px-6 mb-16 flex justify-between items-end">
        <div>
          <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">
            01 // Latest Work
          </span>
          <h2 className="text-4xl md:text-5xl font-display font-medium text-black dark:text-white uppercase">
            Selected <span className="text-neutral-400 dark:text-neutral-500">Works</span>
          </h2>
        </div>
        <div className="hidden md:flex items-center gap-6">
          <Link
            href="/smart-production"
            className="flex items-center gap-2 text-xs font-mono text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white transition-colors uppercase tracking-widest"
          >
            View All Work <ChevronRight className="w-4 h-4" />
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
        onMouseEnter={pause}
        onMouseLeave={resume}
      >
        <div
          ref={trackRef}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="flex gap-8 pl-6"
          style={{ willChange: 'transform' }}
        >
          {loopedItems.map((item, index) => (
            <CarouselCard
              key={`${item.id}-${index < totalCards ? 'a' : 'b'}`}
              item={item}
              isPlaceholder={isPlaceholder}
            />
          ))}
        </div>
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

      {/* Mobile link */}
      <div className="md:hidden flex justify-center mt-8">
        <Link
          href="/smart-production"
          className="flex items-center gap-2 text-xs font-mono text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white transition-colors uppercase tracking-widest"
        >
          View All Work <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </section>
  );
}

// ─── Card Component (memoized to prevent re-renders during scroll) ──────────

const CarouselCard = memo(function CarouselCard({
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
      className="group cursor-pointer flex-shrink-0 w-[85vw] max-w-[85vw] md:w-[600px] md:max-w-[600px]"
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
              unoptimized
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
});
