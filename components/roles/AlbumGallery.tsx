'use client';

import { useState } from 'react';
import type { RoleEvidence } from '@/lib/roles';

/**
 * One gallery, album tabs, the work shown large (092). With one album there
 * are no tabs. Work only: never a face (the profile is blind until booking).
 */
export function AlbumGallery({ albums }: { albums: { name: string; items: RoleEvidence[] }[] }) {
  const [active, setActive] = useState(0);
  if (!albums.length) return null;
  const album = albums[Math.min(active, albums.length - 1)];
  const [first, ...rest] = album.items;

  return (
    <section className="mb-6" aria-label="Work">
      {albums.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4" role="tablist" aria-label="Albums">
          {albums.map((a, i) => (
            <button
              key={a.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`shrink-0 min-h-[44px] px-4 border text-sm ${i === active ? 'border-accent-gold text-accent-gold' : 'border-white/15 text-neutral-300'}`}
            >
              {a.name} <span className="text-neutral-500">({a.items.length})</span>
            </button>
          ))}
        </div>
      )}
      {first && (
        <figure className="w-full bg-neutral-900 overflow-hidden mb-2">
          {first.kind === 'video' ? (
            <video src={first.url ?? undefined} className="w-full max-h-[70vh] object-contain" controls playsInline preload="metadata" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={first.url ?? ''} alt={`${album.name}`} className="w-full max-h-[70vh] object-cover" />
          )}
        </figure>
      )}
      {rest.length > 0 && (
        <ul className="grid grid-cols-2 gap-2">
          {rest.map((e) => (
            <li key={e.id} className="aspect-[4/5] bg-neutral-900 overflow-hidden">
              {e.kind === 'video' ? (
                <video src={e.url ?? undefined} className="w-full h-full object-cover" controls playsInline preload="none" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.url ?? ''} alt="" className="w-full h-full object-cover" loading="lazy" />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
