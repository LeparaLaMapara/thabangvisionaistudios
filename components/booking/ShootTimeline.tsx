'use client';

import { shootTimeline, type TimelineBooking } from '@/lib/bookings/timeline';

const DOT: Record<string, string> = {
  done: 'bg-emerald-400 border-emerald-400',
  current: 'bg-[#D4A843] border-[#D4A843] animate-pulse',
  upcoming: 'bg-transparent border-neutral-600',
  skipped: 'bg-transparent border-neutral-700 border-dashed',
  stopped: 'bg-transparent border-red-500/50',
};

/** The shared booking timeline (TASK-069): the same steps for client and creator. */
export function ShootTimeline({ booking, viewer }: { booking: TimelineBooking; viewer: 'client' | 'creator' }) {
  const steps = shootTimeline(booking, viewer);
  const current = steps.find((s) => s.state === 'current');
  return (
    <div className="mt-4">
      <ol className="flex items-center gap-1" aria-label="Booking progress">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1 flex-1 min-w-0" title={s.label}>
            <span className={`w-2.5 h-2.5 rounded-full border shrink-0 ${DOT[s.state]}`} aria-hidden="true" />
            {i < steps.length - 1 && (
              <span className={`h-px flex-1 ${s.state === 'done' ? 'bg-emerald-400/60' : 'bg-neutral-700'}`} aria-hidden="true" />
            )}
            <span className="sr-only">
              {s.label}: {s.state}
            </span>
          </li>
        ))}
      </ol>
      {current ? (
        <p className="mt-2 text-xs font-mono text-neutral-400">
          <span className="text-[#D4A843]">Next: {current.label}.</span> {current.next}
        </p>
      ) : (
        booking.status !== 'cancelled' && <p className="mt-2 text-xs font-mono text-emerald-400">All done.</p>
      )}
    </div>
  );
}
