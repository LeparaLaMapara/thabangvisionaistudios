'use client';

import Image from 'next/image';
import Link from 'next/link';
import { MapPin, Star } from 'lucide-react';
import type { CrewMember } from '@/lib/supabase/queries/crew';
import { STUDIO } from '@/lib/constants';

interface CrewCardProps {
  member: CrewMember;
  avgRating?: number | null;
  totalReviews?: number;
}

export default function CrewCard({ member, avgRating, totalReviews = 0 }: CrewCardProps) {
  const initials = member.display_name
    ? member.display_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '??';

  const primarySpec = member.specializations?.[0] || 'Creative Professional';

  return (
    <Link href={`/crew/${member.crew_slug}`} className="group block">
      <div className="bg-[#0A0A0B] border border-white/5 hover:border-white/20 transition-all overflow-hidden">
        {/* Avatar */}
        <div className="relative w-full aspect-square bg-neutral-900 overflow-hidden">
          {member.avatar_url ? (
            <Image
              src={member.avatar_url}
              alt={member.display_name || 'Crew member'}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl font-display font-bold text-neutral-600">
              {initials}
            </div>
          )}
          {member.crew_featured && (
            <span className="absolute top-3 left-3 text-[8px] font-mono uppercase tracking-widest bg-[#D4A843] text-black px-2 py-1">
              Featured
            </span>
          )}
        </div>

        {/* Info */}
        <div className="p-5">
          <h3 className="text-sm font-display font-medium uppercase text-white truncate">
            {member.display_name}
          </h3>
          <p className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest mt-0.5">
            {primarySpec}
          </p>

          {member.location && (
            <p className="text-[10px] font-mono text-neutral-600 flex items-center gap-1 mt-2">
              <MapPin className="w-3 h-3" />
              {member.location}
            </p>
          )}

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
            <span className="text-xs font-mono text-white">
              {member.hourly_rate
                ? `${STUDIO.currency.symbol}${member.hourly_rate.toLocaleString()}/hr`
                : 'Contact for rate'}
            </span>

            {avgRating ? (
              <span className="text-[10px] font-mono text-neutral-400 flex items-center gap-1">
                <Star className="w-3 h-3 text-[#D4A843] fill-[#D4A843]" />
                {avgRating} ({totalReviews})
              </span>
            ) : (
              <span className="text-[10px] font-mono text-neutral-600">New</span>
            )}
          </div>

          {/* Skills */}
          {member.specializations && member.specializations.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {member.specializations.slice(0, 3).map((spec) => (
                <span
                  key={spec}
                  className="text-[8px] font-mono uppercase tracking-widest text-neutral-500 border border-white/5 px-2 py-0.5"
                >
                  {spec}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
