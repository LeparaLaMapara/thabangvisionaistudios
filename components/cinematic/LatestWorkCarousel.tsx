'use client';

import { useRef, useState, useCallback, memo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ChevronRight, Clapperboard, Package, Newspaper } from 'lucide-react';
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

const GAP_PX = 24;
const RESUME_DELAY_MS = 3000;

// ─── Component ────────────────────────────────────────────────────────────────

export function LatestWorkCarousel({ items }: { items: CarouselItem[] }) {
  const displayItems = items.length > 0 ? items : PLACEHOLDER_ITEMS;
  const isPlaceholder = items.length === 0;

  const trackRef = useRef<HTMLDivElement>(null);
  const [touchPaused, setTouchPaused] = useState(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Duration scales with card count so speed stays constant
  // ~4s per card gives a smooth, readable pace
  const duration = displayItems.length * 4;

  // ── Touch / swipe handlers ────────────────────────────────────────────────

  const touchStartX = useRef(0);
  const touchStartScroll = useRef(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    setTouchPaused(true);
    touchStartX.current = e.touches[0].clientX;
    // Record current computed translateX so we can drag from there
    if (trackRef.current) {
      const style = getComputedStyle(trackRef.current);
      const matrix = new DOMMatrixReadOnly(style.transform);
      touchStartScroll.current = matrix.m41; // current translateX value
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!trackRef.current) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    trackRef.current.style.transform = `translateX(${touchStartScroll.current + dx}px)`;
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!trackRef.current) return;
    // Remove inline transform so CSS animation resumes from current position
    trackRef.current.style.transform = '';
    resumeTimer.current = setTimeout(() => {
      setTouchPaused(false);
    }, RESUME_DELAY_MS);
  }, []);

  return (
    <section className="py-32 bg-neutral-50 dark:bg-[#050505] transition-colors duration-500">
      {/* Inject keyframes */}
      <style>{`
        @keyframes marquee-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>

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
        </div>
      </div>

      {/* Marquee */}
      <div className="relative overflow-hidden">
        <div
          ref={trackRef}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="flex w-max hover:[animation-play-state:paused]"
          style={{
            gap: `${GAP_PX}px`,
            animation: isPlaceholder || touchPaused
              ? 'none'
              : `marquee-scroll ${duration}s linear infinite`,
            willChange: 'transform',
          }}
        >
          {/* First set */}
          {displayItems.map((item) => (
            <CarouselCard key={item.id} item={item} isPlaceholder={isPlaceholder} />
          ))}
          {/* Duplicate set for seamless loop */}
          {displayItems.map((item) => (
            <CarouselCard key={`dup-${item.id}`} item={item} isPlaceholder={isPlaceholder} />
          ))}
        </div>
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
      className="group cursor-pointer flex-shrink-0 w-[300px] md:w-[400px]"
    >
      <div className="relative overflow-hidden mb-6 bg-neutral-200 dark:bg-neutral-900 border border-black/5 dark:border-white/10 w-full h-[200px] md:h-[260px]">
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
              sizes="(max-width: 768px) 300px, 400px"
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
