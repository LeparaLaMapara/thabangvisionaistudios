'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { RentalVideo } from '@/lib/rental/on-site';
import { mayAutoplay } from '@/components/rentals/RentalLoopVideo';

/**
 * A listing's own videos, one at a time, swiped sideways on a phone (CSS
 * scroll snap) or stepped with the arrows, the dots or the arrow keys on a
 * computer. Only the video on screen plays: muted and looping on its own when
 * mayAutoplay() allows it (fast connection, no data saver, no reduced
 * motion), otherwise when the visitor taps Play. Every other video is paused,
 * and so is the one on screen once the carousel scrolls out of view. Sound is
 * one tap away and stays on for the next video.
 */
export function RentalVideoCarousel({ videos, label }: { videos: RentalVideo[]; label: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [onScreen, setOnScreen] = useState(false);
  // mayAutoplay(), read once the carousel first comes on screen (the browser only).
  const auto = useRef<boolean | null>(null);
  // Started by a tap (when autoplay is not allowed) or paused by a tap.
  const [wantsPlay, setWantsPlay] = useState<boolean | null>(null);
  const [muted, setMuted] = useState(true);
  // The video that is playing right now, if any.
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const playing = playingIdx === active;
  const count = videos.length;

  // Which slide is in the track's view.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = slideRefs.current.indexOf(e.target as HTMLDivElement);
          if (i >= 0) setActive(i);
        }
      },
      { root: track, threshold: 0.6 },
    );
    slideRefs.current.forEach((s) => s && io.observe(s));
    return () => io.disconnect();
  }, [count]);

  // Whether the carousel itself is on the page's screen.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (auto.current === null) auto.current = mayAutoplay();
        setOnScreen(e.isIntersecting);
      },
      { threshold: 0.4 },
    );
    io.observe(track);
    return () => io.disconnect();
  }, []);

  // Play the slide on screen, pause the rest.
  useEffect(() => {
    const shouldPlay = onScreen && (wantsPlay ?? auto.current === true);
    videoRefs.current.forEach((v, i) => {
      if (!v) return;
      if (i === active && shouldPlay) {
        v.muted = muted;
        v.play().catch(() => {
          // A browser can refuse sound without a fresh tap: fall back to muted.
          if (!v.muted) {
            v.muted = true;
            setMuted(true);
            v.play().catch(() => undefined);
          }
        });
      } else if (!v.paused) {
        v.pause();
      }
    });
  }, [active, onScreen, wantsPlay, muted]);

  const goTo = useCallback(
    (i: number) => {
      const track = trackRef.current;
      const n = Math.max(0, Math.min(count - 1, i));
      if (!track) return;
      track.scrollTo({ left: n * track.clientWidth, behavior: 'smooth' });
      setActive(n);
    },
    [count],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(active + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(active - 1);
    }
  };

  const togglePlay = () => {
    const v = videoRefs.current[active];
    if (!v) return;
    if (v.paused) {
      setWantsPlay(true);
      v.play().catch(() => undefined);
    } else {
      setWantsPlay(false);
      v.pause();
    }
  };

  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    const v = videoRefs.current[active];
    if (v) {
      v.muted = next;
      // Turning sound on is a request to hear it: start the video too.
      if (!next) setWantsPlay(true);
    }
  };

  if (count === 0) return null;
  const current = videos[active] ?? videos[0];

  return (
    <section
      aria-roledescription="carousel"
      aria-label={`${label}: videos from our shoots`}
      className="mx-auto w-full max-w-sm"
      // On a phone the whole carousel (video, dots) fits between the header and
      // the booking bar: the width follows the screen height, the 9:16 box follows the width.
      style={{ maxWidth: 'max(14rem, min(24rem, calc((100svh - 17rem) * 9 / 16)))' }}
    >
      <div className="relative">
        <div
          ref={trackRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          aria-label="Swipe or use the arrow keys to see the next video"
          className="scrollbar-hide flex aspect-[9/16] w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain border border-white/10 bg-black outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
          data-testid="rental-video-track"
        >
          {videos.map((v, i) => (
            <div
              key={v.url}
              ref={(el) => {
                slideRefs.current[i] = el;
              }}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}${v.title ? `: ${v.title}` : ''}`}
              className="relative h-full w-full shrink-0 snap-center snap-always"
            >
              <video
                ref={(el) => {
                  videoRefs.current[i] = el;
                }}
                src={v.url}
                poster={v.poster ?? undefined}
                muted
                loop
                playsInline
                preload="metadata"
                aria-label={v.title ?? `${label}, video ${i + 1}`}
                onPlay={() => setPlayingIdx(i)}
                onPause={() => setPlayingIdx((p) => (p === i ? null : p))}
                className="h-full w-full object-cover"
                data-testid="rental-video"
              />
            </div>
          ))}
        </div>

        {/* Play and sound, for the video on screen (top corner, clear of the chat button). */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={toggleSound}
            className="pointer-events-auto inline-flex min-h-[44px] items-center gap-2 rounded-full bg-black/60 px-4 font-mono text-xs uppercase tracking-widest text-white backdrop-blur transition-colors hover:bg-black/80"
            aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
            aria-pressed={!muted}
          >
            {muted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
            {muted ? 'Sound' : 'Sound on'}
          </button>
          <button
            type="button"
            onClick={togglePlay}
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
            aria-label={playing ? `Pause video ${active + 1}` : `Play video ${active + 1}`}
          >
            {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>

        {/* Arrows on a computer; a phone swipes. */}
        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => goTo(active - 1)}
              disabled={active === 0}
              className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-opacity hover:bg-black/80 disabled:opacity-0 sm:flex"
              aria-label="Previous video"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => goTo(active + 1)}
              disabled={active === count - 1}
              className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-opacity hover:bg-black/80 disabled:opacity-0 sm:flex"
              aria-label="Next video"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-mono text-xs uppercase tracking-widest text-neutral-400" aria-live="polite">
          {current.title ?? label}
          {count > 1 && <span className="sr-only">, video {active + 1} of {count}</span>}
        </p>
        {count > 1 && (
          <div className="flex shrink-0">
            {videos.map((v, i) => (
              <button
                key={v.url}
                type="button"
                onClick={() => goTo(i)}
                className="flex h-11 w-8 items-center justify-center"
                aria-label={`Show video ${i + 1} of ${count}`}
                aria-current={i === active ? 'true' : undefined}
              >
                <span
                  className={`block h-1.5 rounded-full transition-all ${i === active ? 'w-5 bg-accent-gold' : 'w-1.5 bg-white/40'}`}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
