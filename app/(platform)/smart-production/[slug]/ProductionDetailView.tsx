'use client';

import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { PhotographyGallery } from '@/components/projects/ProjectsComponents';
import type { SmartProduction } from '@/lib/supabase/queries/smartProductions';

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
}: {
  project: SmartProduction;
}) {
  // Gallery: DB stores [{ url, public_id }] — PhotographyGallery expects string[]
  const galleryUrls = project.gallery?.map(g => g.url) ?? [];
  const videoId     = extractVideoId(project.video_provider, project.video_url);

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
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
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
          </div>

        </div>
      </div>
    </div>
  );
}
