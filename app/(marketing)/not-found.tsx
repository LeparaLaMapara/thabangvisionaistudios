import Link from 'next/link';

/**
 * "Not found" inside the site: the header and footer come from this section's
 * layout, so this is only the message. (app/not-found.tsx, for addresses that
 * match no page at all, brings its own header and footer.)
 */
export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-40 px-6">
      <p className="text-neutral-400 uppercase tracking-widest text-sm font-mono">
        404 — Page Not Found
      </p>
      <Link
        href="/"
        className="min-h-[44px] inline-flex items-center text-xs font-mono uppercase tracking-widest border border-neutral-800 px-6 py-3 hover:bg-white hover:text-black transition-colors duration-300"
      >
        Return Home
      </Link>
    </div>
  );
}
