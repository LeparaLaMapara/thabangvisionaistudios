export const revalidate = 60;

import { ArrowRight } from 'lucide-react';
import { getPublishedCareers } from '@/lib/supabase/queries/careers';
import { STUDIO } from '@/lib/constants';

export const metadata = {
  title: 'Careers',
};

export default async function CareersPage() {
  const published = await getPublishedCareers();

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-32 pb-20 transition-colors duration-500">
      <div className="container mx-auto px-6">

        {/* Header */}
        <div className="max-w-4xl mb-24">
          <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">
            06 // Recruitment
          </span>
          <h1 className="text-5xl md:text-8xl font-display font-medium text-black dark:text-white tracking-tighter uppercase mb-8 leading-[0.9]">
            Join The <br />
            <span className="text-neutral-400 dark:text-neutral-600">Vision</span>
          </h1>
          <p className="text-xl text-neutral-600 dark:text-neutral-400 font-light leading-relaxed max-w-2xl">
            We are looking for engineers, artists, and problem solvers who want to define
            the future of cinematic imaging.
          </p>
        </div>

        {/* Culture / Benefits */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-32 border-y border-black/10 dark:border-white/10 py-12">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-black dark:text-white mb-4">
              The Lab Access
            </h3>
            <p className="text-sm text-neutral-500 font-mono">
              Full access to our optical lab, machine shop, and stage for personal R&amp;D projects.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-black dark:text-white mb-4">
              Global Network
            </h3>
            <p className="text-sm text-neutral-500 font-mono">
              Opportunities to travel and work on sets in Los Angeles, London, and Dubai.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-black dark:text-white mb-4">
              Radical Innovation
            </h3>
            <p className="text-sm text-neutral-500 font-mono">
              We don&apos;t just use tools; we build them. Push the boundaries of what&apos;s possible in film.
            </p>
          </div>
        </div>

        {/* Open Positions */}
        <div className="mb-20">
          <h2 className="text-2xl font-display font-medium uppercase mb-12 text-black dark:text-white">
            Open Positions
          </h2>

          {published.length === 0 ? (
            <div className="py-20 text-center border border-black/5 dark:border-white/5">
              <p className="text-neutral-500 font-mono text-sm">No open roles at this time.</p>
              <p className="text-neutral-400 dark:text-neutral-600 font-mono text-xs mt-2">
                Check back soon or send a general application below.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {published.map(job => (
                <div
                  key={job.id}
                  className="group relative bg-neutral-50 dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 p-8 md:p-10 hover:border-black/20 dark:hover:border-white/20 transition-all cursor-pointer"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                      <h3 className="text-xl font-display font-bold uppercase text-black dark:text-white mb-2 group-hover:underline decoration-1 underline-offset-4">
                        {job.title}
                      </h3>
                      <div className="flex flex-wrap gap-4 text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-4">
                        {job.department && <span>{job.department}</span>}
                        {job.department && job.location && (
                          <span className="w-px h-3 bg-neutral-300 dark:bg-neutral-700" />
                        )}
                        {job.location && <span>{job.location}</span>}
                        {job.employment_type && (
                          <>
                            <span className="w-px h-3 bg-neutral-300 dark:bg-neutral-700" />
                            <span>{job.employment_type.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                          </>
                        )}
                      </div>
                      {job.description && (
                        <p className="text-sm text-neutral-600 dark:text-neutral-400 font-light max-w-xl">
                          {job.description}
                        </p>
                      )}
                      {job.requirements && job.requirements.length > 0 && (
                        <ul className="mt-4 space-y-1">
                          {job.requirements.map((req, i) => (
                            <li
                              key={i}
                              className="text-xs font-mono text-neutral-500 dark:text-neutral-600 flex items-start gap-2"
                            >
                              <span className="mt-0.5 text-neutral-400">—</span>
                              {req}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex-shrink-0 self-start md:self-center">
                      <a
                        href={`mailto:${STUDIO.careersEmail}?subject=${encodeURIComponent(`Application: ${job.title}`)}`}
                        className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest bg-black text-white dark:bg-white dark:text-black px-6 py-3 hover:opacity-80 transition-opacity"
                      >
                        Apply Now <ArrowRight className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* General Application */}
        <div className="bg-neutral-100 dark:bg-[#080808] p-12 text-center border border-black/5 dark:border-white/5">
          <h3 className="text-lg font-bold uppercase tracking-widest text-black dark:text-white mb-4">
            Don&apos;t see your role?
          </h3>
          <p className="text-neutral-500 mb-8 max-w-lg mx-auto font-mono text-xs">
            We are always looking for exceptional talent. If you believe you belong at {STUDIO.shortName},
            send your portfolio and resume to our talent team.
          </p>
          <a
            href={`mailto:${STUDIO.careersEmail}`}
            className="text-lg font-display underline decoration-1 underline-offset-4 hover:text-neutral-500 transition-colors"
          >
            {STUDIO.careersEmail}
          </a>
        </div>

      </div>
    </div>
  );
}
