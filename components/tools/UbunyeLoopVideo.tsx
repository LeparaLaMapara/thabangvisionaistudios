'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { UbunyeStudioApp } from '@/lib/constants';

interface UbunyeLoopVideoProps {
  media: UbunyeStudioApp['media'];
  label: string;
}

interface ConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * Autoplay only when it is cheap and welcome: the browser reports a fast
 * connection (4g) with data saver off, and the visitor has not asked for less
 * motion. Browsers that do not report the connection (Safari, Firefox) get the
 * Play button, because many visitors pay for every megabyte.
 */
function mayAutoplay(): boolean {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const c = (navigator as Navigator & { connection?: ConnectionLike }).connection;
  if (!c || c.saveData === true) return false;
  return c.effectiveType === '4g';
}

/**
 * A short silent loop of the real app. The poster shows first; nothing is
 * downloaded (preload="none") until the loop plays, either on its own when
 * mayAutoplay() and it is on screen, or when the visitor taps Play.
 */
export function UbunyeLoopVideo({ media, label }: UbunyeLoopVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [auto, setAuto] = useState(false);
  // Set once the visitor pauses: scrolling back never restarts the loop.
  const userPaused = useRef(false);

  useEffect(() => {
    const video = ref.current;
    if (!video || !mayAutoplay()) return;
    // Play while on screen, pause when scrolled away.
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
    <div className="relative aspect-[8/5] w-full overflow-hidden rounded-[22px] border border-white/10 bg-black shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)]">
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        poster={media.poster}
        aria-label={media.alt}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="h-full w-full object-cover"
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
          <span className="inline-flex min-h-[48px] items-center gap-2 rounded-full bg-black/70 px-5 font-sans text-sm text-[var(--ub-text)] backdrop-blur">
            <Play className="h-4 w-4" aria-hidden="true" />
            Play
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={toggle}
          className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-[var(--ub-text)] backdrop-blur transition-colors hover:bg-black/80"
          aria-label={playing ? `Pause: ${label}` : `Play: ${label}`}
        >
          {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
