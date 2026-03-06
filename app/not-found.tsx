import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="h-screen flex flex-col items-center justify-center gap-6">
      <p className="text-neutral-500 uppercase tracking-widest text-sm font-mono">
        404 — Page Not Found
      </p>
      <Link
        href="/"
        className="text-xs font-mono uppercase tracking-widest border border-neutral-800 px-6 py-3 hover:bg-white hover:text-black dark:hover:bg-white dark:hover:text-black transition-colors duration-300"
      >
        Return Home
      </Link>
    </div>
  );
}
