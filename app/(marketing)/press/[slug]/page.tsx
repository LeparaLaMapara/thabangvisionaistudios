import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getPressBySlug } from '@/lib/supabase/queries/press';
import { STUDIO } from '@/lib/constants';

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const article = await getPressBySlug(slug);
  if (!article) return { title: 'Not Found' };
  return {
    title: article.title,
    description: article.excerpt ?? undefined,
  };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(STUDIO.currency.locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default async function PressArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = await getPressBySlug(slug);

  if (!article) notFound();

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-32 pb-20 transition-colors duration-500">
      <div className="container mx-auto px-6">
        {/* Back link */}
        <Link
          href="/press"
          className="inline-flex items-center gap-2 text-xs font-mono text-neutral-500 hover:text-black dark:hover:text-white transition-colors uppercase tracking-widest mb-12"
        >
          <ArrowLeft className="w-3 h-3" /> Back to Press
        </Link>

        {/* Article header */}
        <article className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-6">
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

          <h1 className="text-4xl md:text-6xl font-display font-medium text-black dark:text-white tracking-tighter uppercase mb-8 leading-[0.95]">
            {article.title}
          </h1>

          {article.excerpt && (
            <p className="text-xl text-neutral-600 dark:text-neutral-400 font-light leading-relaxed mb-12 border-l-2 border-black/10 dark:border-white/10 pl-6">
              {article.excerpt}
            </p>
          )}

          {/* Cover image */}
          {article.cover_url && (
            <div className="mb-12 overflow-hidden bg-neutral-100 dark:bg-neutral-900 border border-black/5 dark:border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={article.cover_url}
                alt={article.title}
                className="w-full h-auto object-cover"
              />
            </div>
          )}

          {/* Article content */}
          {article.content ? (
            <div className="prose prose-neutral dark:prose-invert max-w-none font-light leading-relaxed text-neutral-700 dark:text-neutral-300 whitespace-pre-line">
              {article.content}
            </div>
          ) : (
            <div className="py-12 text-center border border-black/5 dark:border-white/5">
              <p className="text-neutral-500 font-mono text-sm">Full article content coming soon.</p>
            </div>
          )}
        </article>

        {/* Footer nav */}
        <div className="mt-20 pt-12 border-t border-black/10 dark:border-white/10">
          <Link
            href="/press"
            className="inline-flex items-center gap-2 text-xs font-mono font-bold text-black dark:text-white uppercase tracking-widest hover:text-neutral-500 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" /> All Articles
          </Link>
        </div>
      </div>
    </div>
  );
}
