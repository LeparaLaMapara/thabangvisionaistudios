import Link from 'next/link';
import { CircleCheck, Circle, ArrowRight } from 'lucide-react';
import { creatorBookableChecklist, type BookableFacts } from '@/lib/creators/bookable';

/**
 * "What makes you bookable", shown to creators on their profile and
 * portfolio pages, so the requirements are visible before they are hit.
 */
export default function CreatorBookableChecklist({ facts, className = '' }: { facts: BookableFacts; className?: string }) {
  const items = creatorBookableChecklist(facts);
  const remaining = items.filter((i) => !i.done).length;
  return (
    <section aria-labelledby="bookable-heading" className={`border border-white/10 bg-[#0A0A0B] p-4 ${className}`}>
      <h3 id="bookable-heading" className="text-xs font-mono uppercase tracking-widest text-white">
        {remaining === 0 ? 'Clients can book you' : 'What makes you bookable'}
      </h3>
      <p className="text-xs font-mono text-neutral-400 mt-1 mb-3">
        {remaining === 0
          ? 'You appear in creator search and can be booked.'
          : `${remaining} of ${items.length} still to do before clients can find and book you.`}
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.step}>
            <Link
              href={item.href}
              className="group flex items-start gap-3 min-h-[44px] py-2 text-xs font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A843]"
            >
              {item.done ? (
                <CircleCheck className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <Circle className="w-4 h-4 text-neutral-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <span className="flex-1 min-w-0">
                <span className={item.done ? 'text-neutral-400' : 'text-white'}>
                  {item.label}
                  <span className="sr-only">{item.done ? ' (done)' : ' (to do)'}</span>
                </span>
                {!item.done && <span className="block text-neutral-500 mt-0.5">{item.detail}</span>}
              </span>
              {!item.done && (
                <ArrowRight className="w-3 h-3 text-neutral-500 group-hover:text-white mt-1" aria-hidden="true" />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
