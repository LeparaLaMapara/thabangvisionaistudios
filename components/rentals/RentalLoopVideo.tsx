'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { LoopMedia } from '@/lib/rental/on-site';

interface ConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * The same rule as the Apps page loops: autoplay only on a fast connection
 * (4g) with data saver off, and when the visitor has not asked for less
 * motion. Browsers that do not report the connection get the Play button,
 * because many visitors pay for every megabyte.
 */
export function mayAutoplay(win: Pick<Window, 'matchMedia' | 'navigator'> = window): boolean {
  if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const c = (win.navigator as Navigator & { connection?: ConnectionLike }).connection;
  if (!c || c.saveData === true) return false;
  return c.effectiveType === '4g';
}

/**
 * A listing's short silent loop. The poster shows first; nothing downloads
 * (preload="none") until the loop plays, on its own when mayAutoplay() and it
 * is on screen, or when the visitor taps Play.
 */
export function RentalLoopVideo({ media, alt, label }: { media: LoopMedia; alt: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [auto, setAuto] = useState(false);
  // Once the visitor pauses, scrolling back never restarts the loop.
  const userPaused = useRef(false);

  useEffect(() => {
    const video = ref.current;
    if (!video || !mayAutoplay()) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (userPaused.current) return;
        if (entry.isIntersecting) {
          setAuto(true);
          video.play().catch(() => setAuto(false));
        } else video.pause();
      },
      { threshold: 0.4 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, []);

  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    if (video.paused) {
      userPaused.current = false;
      video.play().catch(() => undefined);
    } else {
      userPaused.current = true;
      video.pause();
    }
  };

  return (
    <div className="relative mx-auto aspect-[480/592] w-full max-w-sm overflow-hidden border border-white/10 bg-black">
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        poster={media.poster}
        aria-label={alt}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="h-full w-full object-cover"
        data-testid="rental-loop"
      >
        <source src={media.webm} type="video/webm" />
        <source src={media.mp4} type="video/mp4" />
      </video>

      {!playing && !auto ? (
        <button
          type="button"
          onClick={toggle}
          className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors hover:bg-black/20"
          aria-label={`Play: ${label}`}
        >
          <span className="inline-flex min-h-[48px] items-center gap-2 rounded-full bg-black/70 px-5 font-mono text-xs uppercase tracking-widest text-white backdrop-blur">
            <Play className="h-4 w-4" aria-hidden="true" />
            Play
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={toggle}
          className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
          aria-label={playing ? `Pause: ${label}` : `Play: ${label}`}
        >
          {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
