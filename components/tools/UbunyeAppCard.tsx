'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { UbunyeStudioApp } from '@/lib/constants';
import { UB_DISPLAY, UB_LABEL, withAlpha } from './ubunye-styles';

interface UbunyeAppCardProps {
  app: UbunyeStudioApp;
  suiteShortName: string;
  statusLabel: string;
  index: number;
}

/**
 * One tall card per app on /tools. When `app.image` is set it sits behind a
 * dark overlay; until then the card shows a gradient tinted with the accent.
 */
export function UbunyeAppCard({ app, suiteShortName, statusLabel, index }: UbunyeAppCardProps) {
  const fallback = {
    backgroundImage: [
      `radial-gradient(120% 70% at 50% 0%, ${withAlpha(app.accent, '40')} 0%, transparent 62%)`,
      `radial-gradient(90% 50% at 50% 100%, ${withAlpha(app.accent, '14')} 0%, transparent 70%)`,
      'linear-gradient(180deg, var(--ub-bg-2) 0%, var(--ub-bg) 100%)',
    ].join(', '),
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay: index * 0.1, ease: [0.22, 1, 0.36, 1] }}
      className="h-full"
    >
      <Link
        href={`/tools/${app.slug}`}
        className="group relative flex h-full min-h-[520px] flex-col items-center overflow-hidden rounded-[22px] border border-white/10 px-6 pb-10 pt-12 text-center transition-colors duration-300 hover:border-white/25 sm:min-h-[600px]"
        style={app.image ? undefined : fallback}
        aria-label={`${app.name}: ${app.category}. ${app.tagline}`}
      >
        {app.image && (
          <>
            <Image
              src={app.image.src}
              alt={app.image.alt}
              fill
              sizes="(min-width: 1024px) 33vw, 100vw"
              className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
            />
            <div
              className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/55 to-[var(--ub-bg)]"
              aria-hidden="true"
            />
          </>
        )}

        <span
          className={`${UB_LABEL} relative z-10 mb-8 whitespace-nowrap rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[10px] text-[var(--ub-text-2)] sm:text-[10px]`}
        >
          {statusLabel}
        </span>

        <div className="relative z-10 flex flex-1 items-center justify-center">
          <Image
            src={app.icon}
            alt=""
            width={220}
            height={220}
            unoptimized
            priority={index === 0}
            className="h-44 w-44 transition-transform duration-500 group-hover:scale-[1.04] sm:h-52 sm:w-52"
            style={{ filter: `drop-shadow(0 0 32px ${withAlpha(app.accent, '59')})` }}
          />
        </div>

        <div className="relative z-10 mt-8 flex flex-col items-center">
          <h2 className={`${UB_DISPLAY} text-4xl leading-tight sm:text-[2.75rem]`}>
            {suiteShortName} <span style={{ color: app.accent }}>{app.shortName}</span>
          </h2>
          <span
            className="mt-5 block h-[2px] w-10 rounded-full"
            style={{ backgroundColor: app.accent }}
            aria-hidden="true"
          />
          <p className={`${UB_LABEL} mt-6 text-[var(--ub-text)]`}>{app.category}</p>
          <p className={`${UB_DISPLAY} mt-4 max-w-[16rem] text-lg leading-relaxed tracking-wide text-[var(--ub-text-2)]`}>
            {app.tagline}
          </p>
        </div>
      </Link>
    </motion.article>
  );
}
