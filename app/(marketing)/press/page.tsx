export const revalidate = 60;

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { getPublishedPress } from '@/lib/supabase/queries/press';
import { STUDIO } from '@/lib/constants';

export const metadata = {
  title: 'Press',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(STUDIO.currency.locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default async function PressPage() {
  const published = await getPublishedPress();

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-32 pb-20 transition-colors duration-500">
      <div className="container mx-auto px-6">

        {/* Header */}
        <div className="border-b border-black/10 dark:border-white/10 pb-12 mb-20">
          <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">
            Newsroom
          </span>
          <h1 className="text-5xl md:text-8xl font-display font-medium text-black dark:text-white tracking-tighter uppercase">
            Press &amp; <br />
            <span className="text-neutral-400 dark:text-neutral-600">Insights</span>
          </h1>
        </div>

        {/* Articles */}
        {published.length === 0 ? (
          <div className="py-20 text-center border border-black/5 dark:border-white/5">
            <p className="text-neutral-500 font-mono text-sm">No press yet.</p>
          </div>
        ) : (
          <>
            {/* Featured / Hero Article */}
            {(() => {
              const featured = published.find(a => a.is_featured) ?? published[0];
              const rest = published.filter(a => a.id !== featured.id);
              return (
                <>
                  <Link
                    href={`/press/${featured.slug}`}
                    className="group block mb-20"
                  >
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border border-black/5 dark:border-white/5 overflow-hidden bg-neutral-50 dark:bg-[#0A0A0B]">
                      {featured.cover_url && (
                        <div className="overflow-hidden bg-neutral-100 dark:bg-neutral-900 h-72 lg:h-[28rem]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={featured.cover_url}
                            alt={featured.title}
                            className="w-full h-full object-cover grayscale group-hover:grayscale-0 scale-100 group-hover:scale-105 transition-all duration-700"
                          />
                        </div>
                      )}
                      <div className={`${featured.cover_url ? '' : 'lg:col-span-2'} flex flex-col justify-center p-8 lg:p-12`}>
                        <span className="inline-block text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 dark:text-accent mb-4">
                          Featured
                        </span>
                        <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-6">
                          {featured.published_at && <span>{formatDate(featured.published_at)}</span>}
                          {featured.category && (
                            <>
                              <span className="w-px h-3 bg-neutral-300 dark:bg-neutral-700" />
                              <span>{featured.category}</span>
                            </>
                          )}
                          {featured.author && (
                            <>
                              <span className="w-px h-3 bg-neutral-300 dark:bg-neutral-700" />
                              <span>By {featured.author}</span>
                            </>
                          )}
                        </div>
                        <h2 className="text-3xl md:text-5xl font-display uppercase mb-6 text-black dark:text-white group-hover:underline decoration-1 underline-offset-4 leading-[0.95] tracking-tight">
                          {featured.title}
                        </h2>
                        {featured.excerpt && (
                          <p className="text-neutral-600 dark:text-neutral-400 font-light leading-relaxed text-base md:text-lg mb-8">
                            {featured.excerpt}
                          </p>
                        )}
                        <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-black dark:text-white">
                          Read Article <ArrowUpRight className="w-4 h-4 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                        </div>
                      </div>
                    </div>
                  </Link>

                  {/* Remaining articles */}
                  {rest.length > 0 && (
                    <div className="grid grid-cols-1 gap-12">
                      {rest.map(article => (
                        <Link
                          key={article.id}
                          href={`/press/${article.slug}`}
                          className="group grid grid-cols-1 md:grid-cols-12 gap-8 border-b border-black/5 dark:border-white/5 pb-12 last:border-0"
                        >
                          {article.cover_url && (
                            <div className="md:col-span-4 overflow-hidden bg-neutral-100 dark:bg-neutral-900 h-64 md:h-full">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={article.cover_url}
                                alt={article.title}
                                className="w-full h-full object-cover grayscale group-hover:grayscale-0 scale-100 group-hover:scale-105 transition-all duration-700"
                              />
                            </div>
                          )}
                          <div
                            className={`${article.cover_url ? 'md:col-span-8' : 'md:col-span-12'} flex flex-col justify-between py-4`}
                          >
                            <div>
                              <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-4">
                                {article.published_at && <span>{formatDate(article.published_at)}</span>}
                                {article.category && (
                                  <>
                                    <span className="w-px h-3 bg-neutral-300 dark:bg-neutral-700" />
                                    <span>{article.category}</span>
                                  </>
                                )}
                                {article.author && (
                                  <>
                                    <span className="w-px h-3 bg-neutral-300 dark:bg-neutral-700" />
                                    <span>By {article.author}</span>
                                  </>
                                )}
                              </div>
                              <h2 className="text-3xl md:text-4xl font-display uppercase mb-4 text-black dark:text-white group-hover:underline decoration-1 underline-offset-4">
                                {article.title}
                              </h2>
                              {article.excerpt && (
                                <p className="text-neutral-600 dark:text-neutral-400 max-w-2xl font-light leading-relaxed">
                                  {article.excerpt}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest mt-8 text-black dark:text-white">
                              Read Article <ArrowUpRight className="w-4 h-4 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </>
        )}

        {/* Media Inquiries */}
        <div className="mt-20 border-t border-black/10 dark:border-white/10 pt-12">
          <h3 className="text-sm font-bold uppercase tracking-widest text-black dark:text-white mb-6">
            Media Inquiries
          </h3>
          <p className="text-neutral-500 text-sm font-mono mb-4">
            For press kits, high-res assets, and interview requests:
          </p>
          <a
            href={`mailto:${STUDIO.pressEmail}`}
            className="text-lg font-display underline decoration-1 underline-offset-4 hover:text-neutral-500 transition-colors"
          >
            {STUDIO.pressEmail}
          </a>
        </div>

      </div>
    </div>
  );
}
