'use client';

import { useState } from 'react';
import { youtubeEmbedUrl, youtubePosterUrl, youtubeWatchUrl } from '@/lib/video/youtube';

/**
 * A rental item's video. YouTube: the video's own picture and a play button
 * until the person presses play, then the player (youtube-nocookie.com). A
 * "Watch on YouTube" link stays under it, so there is always a way to watch:
 * Google sometimes answers an embed with a robot check that a website may not
 * show in a frame, which used to leave an empty grey box. Vimeo: the player.
 */
export function ProductVideo({
  provider,
  videoId,
  title,
}: {
  provider: 'youtube' | 'vimeo';
  videoId: string;
  title: string;
}) {
  const [playing, setPlaying] = useState(false);

  if (provider === 'vimeo') {
    return (
      <iframe
        src={`https://player.vimeo.com/video/${videoId}`}
        className="absolute inset-0 w-full h-full"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        title={`${title} video`}
      />
    );
  }

  return (
    <>
      {playing ? (
        <iframe
          src={youtubeEmbedUrl(videoId, true)}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          title={`${title} video`}
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play the ${title} video`}
          className="absolute inset-0 w-full h-full group"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={youtubePosterUrl(videoId)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
          <span className="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-16 h-16 rounded-full bg-white/90 group-hover:bg-white flex items-center justify-center shadow-lg transition-colors">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-black translate-x-0.5" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        </button>
      )}
      <a
        href={youtubeWatchUrl(videoId)}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-2 right-2 z-10 text-[11px] font-mono uppercase tracking-widest bg-black/70 text-white px-2.5 py-1.5 hover:bg-black"
      >
        Watch on YouTube ↗
      </a>
    </>
  );
}
