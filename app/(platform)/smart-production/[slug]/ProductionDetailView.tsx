'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, Aperture, Camera } from 'lucide-react';
import Link from 'next/link';
import { PhotographyGallery } from '@/components/projects/ProjectsComponents';
import { STUDIO } from '@/lib/constants';
import type { SmartProduction, ImageExifMetadata } from '@/lib/supabase/queries/smartProductions';

// ─── Types ───────────────────────────────────────────────────────────────────

export type MatchedGear = {
  title: string;
  slug: string;
  category: string;
  pricePerDay: number;
  thumbnail: string | null;
  brand: string | null;
  model: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extracts the YouTube video ID from a watch or short URL.
 * Returns null for any other provider or missing URL.
 */
function extractVideoId(
  provider: string | null,
  url: string | null,
): string | null {
  if (!provider || !url) return null;
  if (provider === 'youtube') {
    const m = url.match(/(?:v=|youtu\.be\/)([^&\n?#]+)/);
    return m?.[1] ?? null;
  }
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductionDetailView({
  project,
  matchedGear = [],
}: {
  project: SmartProduction;
  matchedGear?: MatchedGear[];
}) {
  // Gallery: DB stores [{ url, public_id }] — PhotographyGallery expects string[]
  const galleryUrls = project.gallery?.map(g => g.url) ?? [];
  const videoId     = extractVideoId(project.video_provider, project.video_url);

  // Deduplicate metadata — show unique camera+lens combos
  const metadata = project.image_metadata ?? [];
  const primaryMeta = metadata.length > 0 ? metadata[0] : null;
  const uniqueGear = getUniqueGear(metadata);

  // ── Photography layout ──────────────────────────────────────────────────────
  if (project.project_type === 'photography') {
    return (
      <div className="min-h-screen bg-white dark:bg-[#050505] transition-colors duration-500">
        <div className="fixed top-20 left-0 w-full z-40 bg-white/90 dark:bg-[#050505]/90 backdrop-blur-md border-b border-black/5 dark:border-white/5 py-4 px-6 flex justify-between items-center">
          <Link
            href="/smart-production"
            className="text-[10px] font-mono font-bold tracking-widest text-neutral-500 hover:text-black dark:hover:text-white uppercase flex items-center gap-2 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" /> All Productions
          </Link>
          <h1 className="text-sm font-display font-bold text-black dark:text-white uppercase tracking-widest">
            {project.title}{' '}
            <span className="text-neutral-400 font-normal">// {project.sub_category}</span>
          </h1>
          <div className="w-20" />
        </div>

        <div className="pt-40 container mx-auto px-4 md:px-6">
          {galleryUrls.length > 0 ? (
            <PhotographyGallery images={galleryUrls} />
          ) : (
            <div className="text-center py-20 text-neutral-500 font-mono text-xs">
              Gallery coming soon.
            </div>
          )}

          {/* EXIF Metadata Bar */}
          {primaryMeta && (
            <div className="mt-12 mb-8 border-t border-black/5 dark:border-white/5 pt-6">
              <ShotInfo metadata={metadata} uniqueGear={uniqueGear} />
            </div>
          )}

          {/* Shot With — linked rental gear */}
          {matchedGear.length > 0 && (
            <div className="mb-16">
              <ShotWithSection gear={matchedGear} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Film layout ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] transition-colors duration-500 pt-20">
      <div className="container mx-auto px-6 py-8">
        <Link
          href="/smart-production"
          className="inline-flex items-center gap-2 text-[10px] font-mono font-bold tracking-widest text-neutral-500 hover:text-black dark:hover:text-white uppercase mb-8 transition-colors"
        >
          <ArrowLeft className="w-3 h-3" /> Back to Productions
        </Link>
      </div>

      {/* Hero video / thumbnail */}
      <div className="container mx-auto px-0 md:px-6 mb-16">
        <div className="relative aspect-video w-full bg-black overflow-hidden shadow-2xl">
          {videoId ? (
            <iframe
              width="100%"
              height="100%"
              src={`https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&autohide=1&showinfo=0&controls=1`}
              title={project.title}
              frameBorder="0"
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={project.thumbnail_url ?? ''}
              alt="Cover"
              className="w-full h-full object-cover opacity-50"
            />
          )}
        </div>
      </div>

      {/* Details */}
      <div className="container mx-auto px-6 pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">

          {/* Left: title + tags + description */}
          <div className="lg:col-span-8">
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl md:text-6xl font-display font-medium text-black dark:text-white uppercase mb-6"
            >
              {project.title}
            </motion.h1>

            <div className="flex flex-wrap gap-2 mb-8">
              {(project.tags ?? []).map(tag => (
                <span
                  key={tag}
                  className="px-3 py-1 border border-black/10 dark:border-white/10 text-[10px] font-mono uppercase tracking-widest text-neutral-600 dark:text-neutral-400"
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="prose prose-lg text-neutral-600 dark:text-neutral-400 font-light leading-relaxed max-w-none">
              <p>{project.description}</p>
            </div>
          </div>

          {/* Right: meta */}
          <div className="lg:col-span-4 space-y-8 pt-4">
            <div className="border-t border-black/10 dark:border-white/10 pt-4">
              <span className="block text-[10px] font-mono text-neutral-500 uppercase tracking-widest mb-1">
                Client
              </span>
              <span className="text-lg font-display text-black dark:text-white">
                {project.client ?? 'Internal'}
              </span>
            </div>

            <div className="border-t border-black/10 dark:border-white/10 pt-4">
              <span className="block text-[10px] font-mono text-neutral-500 uppercase tracking-widest mb-1">
                Year
              </span>
              <span className="text-lg font-display text-black dark:text-white">
                {project.year ?? '2025'}
              </span>
            </div>

            {project.sub_category && (
              <div className="border-t border-black/10 dark:border-white/10 pt-4">
                <span className="block text-[10px] font-mono text-neutral-500 uppercase tracking-widest mb-1">
                  Category
                </span>
                <span className="text-lg font-display text-black dark:text-white">
                  {project.sub_category}
                </span>
              </div>
            )}

            {/* Shot info */}
            {primaryMeta && (
              <div className="border-t border-black/10 dark:border-white/10 pt-4">
                <ShotInfo metadata={metadata} uniqueGear={uniqueGear} />
              </div>
            )}

            {/* Shot With — linked rental gear */}
            {matchedGear.length > 0 && (
              <div className="border-t border-black/10 dark:border-white/10 pt-4">
                <ShotWithSection gear={matchedGear} />
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Shot Info Component ──────────────────────────────────────────────────────

function getUniqueGear(
  metadata: ImageExifMetadata[],
): { camera: string; lens?: string }[] {
  const seen = new Set<string>();
  const result: { camera: string; lens?: string }[] = [];

  for (const m of metadata) {
    if (!m.camera) continue;
    const key = `${m.camera}|${m.lens ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ camera: m.camera, lens: m.lens });
  }

  return result;
}

function ShotWithSection({ gear }: { gear: MatchedGear[] }) {
  return (
    <div className="space-y-4">
      <span className="flex items-center gap-2 text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
        <Camera className="w-3 h-3" />
        Shot On {STUDIO.shortName} Gear
      </span>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {gear.map((item) => (
          <Link
            key={item.slug}
            href={`/smart-rentals/${item.category}/${item.slug}`}
            className="group flex flex-col bg-[#0A0A0B] border border-white/5 hover:border-white/20 transition-all duration-300 overflow-hidden"
          >
            {/* Thumbnail */}
            <div className="relative aspect-square overflow-hidden bg-neutral-900">
              {item.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbnail}
                  alt={item.title}
                  className="w-full h-full object-cover grayscale group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700 ease-out"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Camera className="w-8 h-8 text-neutral-700" />
                </div>
              )}
              {/* Studio badge */}
              <span className="absolute top-2 left-2 z-10 text-[8px] font-mono uppercase tracking-widest bg-[#D4A843]/90 text-black px-2 py-0.5">
                Studio
              </span>
            </div>

            {/* Content */}
            <div className="flex flex-col flex-grow p-4">
              {/* Brand */}
              {item.brand && (
                <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-500 mb-1">
                  {item.brand}
                </span>
              )}

              {/* Title */}
              <h3 className="text-sm font-display font-medium text-white uppercase leading-tight group-hover:underline decoration-[#D4A843] underline-offset-4 transition-colors">
                {item.title}
              </h3>

              {/* Model */}
              {item.model && (
                <p className="text-[10px] font-mono text-neutral-600 mt-1">
                  {item.model}
                </p>
              )}

              {/* Spacer */}
              <div className="flex-grow" />

              {/* Price + CTA */}
              <div className="flex items-end justify-between mt-4 pt-3 border-t border-white/5">
                <div>
                  <span className="text-base font-display font-medium text-white">
                    {STUDIO.currency.symbol}{item.pricePerDay.toLocaleString()}
                  </span>
                  <span className="text-[10px] font-mono text-neutral-600 ml-1">/ day</span>
                </div>
                <span className="text-[9px] font-mono uppercase tracking-widest text-[#D4A843] group-hover:translate-x-1 transition-transform duration-300">
                  View Details &rarr;
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ShotInfo({
  metadata,
  uniqueGear,
}: {
  metadata: ImageExifMetadata[];
  uniqueGear: { camera: string; lens?: string }[];
}) {
  // Aggregate common settings from first image with full data
  const primary = metadata.find(m => m.camera || m.iso) ?? metadata[0];
  if (!primary) return null;

  const settingsLine = [
    primary.focalLength ? `${primary.focalLength}mm` : null,
    primary.aperture ? `f/${primary.aperture}` : null,
    primary.iso ? `ISO ${primary.iso}` : null,
    primary.shutterSpeed ?? null,
  ]
    .filter(Boolean)
    .join('  ');

  return (
    <div className="space-y-3">
      <span className="flex items-center gap-2 text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
        <Aperture className="w-3 h-3" />
        Shot On
      </span>

      {/* Camera + lens lines */}
      {uniqueGear.map((gear, i) => (
        <div key={i}>
          <span className="text-sm font-display text-black dark:text-white">
            {gear.camera}
          </span>
          {gear.lens && (
            <span className="block text-xs font-mono text-neutral-500 mt-0.5">
              {gear.lens}
            </span>
          )}
        </div>
      ))}

      {/* Settings line */}
      {settingsLine && (
        <p className="text-[10px] font-mono text-neutral-600 dark:text-neutral-500 tracking-wide">
          {settingsLine}
        </p>
      )}

      {/* Software */}
      {primary.software && (
        <p className="text-[9px] font-mono text-neutral-700 uppercase tracking-widest">
          Edited in {primary.software}
        </p>
      )}
    </div>
  );
}
