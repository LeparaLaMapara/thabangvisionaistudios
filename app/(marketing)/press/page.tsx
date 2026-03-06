import { ArrowUpRight } from 'lucide-react';
import { press } from '@/lib/data';

export const metadata = {
  title: 'Press',
};

export default function PressPage() {
  const published = press.filter(a => a.isPublished);

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
          <div className="grid grid-cols-1 gap-12">
            {published.map(article => (
              <div
                key={article.id}
                className="group grid grid-cols-1 md:grid-cols-12 gap-8 border-b border-black/5 dark:border-white/5 pb-12 last:border-0 cursor-pointer"
              >
                {article.coverImage && (
                  <div className="md:col-span-4 overflow-hidden bg-neutral-100 dark:bg-neutral-900 h-64 md:h-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={article.coverImage}
                      alt={article.title}
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 scale-100 group-hover:scale-105 transition-all duration-700"
                    />
                  </div>
                )}
                <div
                  className={`${article.coverImage ? 'md:col-span-8' : 'md:col-span-12'} flex flex-col justify-between py-4`}
                >
                  <div>
                    <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-4">
                      <span>{article.publishedAt}</span>
                    </div>
                    <h2 className="text-3xl md:text-4xl font-display uppercase mb-4 text-black dark:text-white group-hover:underline decoration-1 underline-offset-4">
                      {article.title}
                    </h2>
                    <p className="text-neutral-600 dark:text-neutral-400 max-w-2xl font-light leading-relaxed">
                      {article.content}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest mt-8">
                    Read Article <ArrowUpRight className="w-4 h-4 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                  </div>
                </div>
              </div>
            ))}
          </div>
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
            href="mailto:press@thabangvision.com"
            className="text-lg font-display underline decoration-1 underline-offset-4 hover:text-neutral-500 transition-colors"
          >
            press@thabangvision.com
          </a>
        </div>

      </div>
    </div>
  );
}
