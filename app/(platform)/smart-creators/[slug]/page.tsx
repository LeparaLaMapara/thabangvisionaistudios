export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { MapPin, Star, Clock, ExternalLink } from 'lucide-react';
import { getCrewBySlug, getCrewReviews } from '@/lib/supabase/queries/crew';
import { createClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const creator = await getCrewBySlug(slug);
  if (!creator) return { title: 'Creator Not Found' };
  return {
    title: `${creator.display_name} | Smart Creators | ${STUDIO.shortName}`,
    description: creator.crew_bio || creator.bio || `${creator.display_name} on ${STUDIO.shortName}`,
  };
}

export default async function CreatorDetailPage({ params }: Props) {
  const { slug } = await params;
  const creator = await getCrewBySlug(slug);
  if (!creator) notFound();

  const supabase = await createClient();

  // Fetch related data
  const [listings, productions, reviews] = await Promise.all([
    supabase
      .from('listings')
      .select('id, title, price, pricing_model, category')
      .eq('user_id', creator.id)
      .eq('is_published', true)
      .is('deleted_at', null)
      .limit(6),
    supabase
      .from('smart_productions')
      .select('id, title, slug, project_type, thumbnail_url')
      .contains('crew_ids', [creator.id])
      .limit(6),
    getCrewReviews(creator.id),
  ]);

  const ratings = reviews.map((r) => r.rating);
  const avgRating =
    ratings.length > 0
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
      : null;

  const initials = creator.display_name
    ? creator.display_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '??';

  const bookPrompt = encodeURIComponent(
    `I'd like to book ${creator.display_name} for a project.`,
  );

  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      {/* Back link */}
      <Link
        href="/smart-creators"
        className="text-[10px] font-mono uppercase tracking-widest text-[#D4A843]/60 hover:text-[#D4A843] transition-colors mb-8 inline-block"
      >
        &larr; Back to Smart Creators
      </Link>

      {/* Hero */}
      <div className="flex flex-col md:flex-row gap-8 mb-12">
        {/* Avatar */}
        <div className="relative w-40 h-40 rounded-full overflow-hidden border-2 border-white/10 bg-neutral-900 flex-shrink-0 mx-auto md:mx-0">
          {creator.avatar_url ? (
            <Image
              src={creator.avatar_url}
              alt={creator.display_name || 'Creator'}
              fill
              sizes="160px"
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-3xl font-display font-bold text-neutral-600">
              {initials}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="text-center md:text-left">
          <h1 className="text-3xl font-display font-medium uppercase tracking-tight text-white">
            {creator.display_name}
          </h1>
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-500 mt-1">
            {creator.specializations?.join(' & ') || 'Creative Professional'}
          </p>

          <div className="flex flex-wrap items-center gap-4 mt-3 justify-center md:justify-start">
            {creator.location && (
              <span className="text-[10px] font-mono text-neutral-400 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {creator.location}
              </span>
            )}
            {creator.hourly_rate && (
              <span className="text-xs font-mono text-white">
                {STUDIO.currency.symbol}{creator.hourly_rate.toLocaleString()}/hr
              </span>
            )}
            {creator.years_experience && (
              <span className="text-[10px] font-mono text-neutral-400 flex items-center gap-1">
                <Clock className="w-3 h-3" /> {creator.years_experience} years experience
              </span>
            )}
            {avgRating && (
              <span className="text-[10px] font-mono text-neutral-400 flex items-center gap-1">
                <Star className="w-3 h-3 text-[#D4A843] fill-[#D4A843]" />
                {avgRating} ({reviews.length} review{reviews.length !== 1 ? 's' : ''})
              </span>
            )}
          </div>
        </div>
      </div>

      {/* About */}
      {(creator.crew_bio || creator.bio) && (
        <Section title="About">
          <p className="text-sm font-mono text-neutral-300 leading-relaxed whitespace-pre-line">
            {creator.crew_bio || creator.bio}
          </p>
        </Section>
      )}

      {/* Skills */}
      {creator.specializations && creator.specializations.length > 0 && (
        <Section title="Skills">
          <div className="flex flex-wrap gap-2">
            {[...(creator.specializations || []), ...(creator.skills || [])].map((skill) => (
              <span
                key={skill}
                className="text-[9px] font-mono uppercase tracking-widest border border-white/10 px-3 py-1.5 text-neutral-400"
              >
                {skill}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Equipment */}
      {listings.data && listings.data.length > 0 && (
        <Section title="Their Equipment">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {listings.data.map((item: { id: string; title: string; price: number; pricing_model: string; category: string }) => (
              <div
                key={item.id}
                className="bg-neutral-900 border border-white/5 p-4 flex items-center justify-between"
              >
                <div>
                  <p className="text-xs font-mono text-white">{item.title}</p>
                  <p className="text-[9px] font-mono text-neutral-500 uppercase">{item.category}</p>
                </div>
                <span className="text-xs font-mono text-neutral-400">
                  {STUDIO.currency.symbol}{item.price}/{item.pricing_model}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Recent Work */}
      {productions.data && productions.data.length > 0 && (
        <Section title="Recent Work">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {productions.data.map((prod: { id: string; title: string; slug: string; project_type: string; thumbnail_url: string | null }) => (
              <Link
                key={prod.id}
                href={`/smart-production/${prod.slug}`}
                className="bg-neutral-900 border border-white/5 p-4 hover:border-white/20 transition-colors group"
              >
                <p className="text-xs font-mono text-white group-hover:text-[#D4A843] transition-colors">
                  {prod.title}
                </p>
                <p className="text-[9px] font-mono text-neutral-500 uppercase">{prod.project_type}</p>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {/* Reviews */}
      {reviews.length > 0 && (
        <Section title="Reviews">
          <div className="space-y-4">
            {reviews.map((review) => (
              <div key={review.id} className="bg-neutral-900 border border-white/5 p-5">
                <div className="flex items-center gap-2 mb-2">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      key={i}
                      className={`w-3 h-3 ${i < review.rating ? 'text-[#D4A843] fill-[#D4A843]' : 'text-neutral-700'}`}
                    />
                  ))}
                </div>
                {review.comment && (
                  <p className="text-xs font-mono text-neutral-300 leading-relaxed mb-2">
                    &ldquo;{review.comment}&rdquo;
                  </p>
                )}
                <p className="text-[9px] font-mono text-neutral-500">
                  — {review.reviewer_name},{' '}
                  {new Date(review.created_at).toLocaleDateString('en-ZA', {
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Social Links (no email/phone) */}
      {creator.social_links && Object.keys(creator.social_links).length > 0 && (
        <Section title="Social">
          <div className="flex flex-wrap gap-3">
            {Object.entries(creator.social_links)
              .filter(([, url]) => {
                try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol); } catch { return false; }
              })
              .map(([platform, url]) => (
              <a
                key={platform}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white border border-white/10 px-3 py-2 flex items-center gap-1.5 transition-colors"
              >
                {platform}
                <ExternalLink className="w-3 h-3" />
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* Book CTA */}
      <div className="mt-12 text-center">
        <Link
          href={`/ubunye-ai-studio?prompt=${bookPrompt}`}
          className="inline-block bg-[#D4A843] text-black px-8 py-4 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
        >
          Book via Ubunye
        </Link>
        <p className="text-[9px] font-mono text-neutral-600 mt-3">
          Opens a conversation with Ubunye to arrange your booking.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-10">
      <div className="w-full h-px bg-white/5 mb-6" />
      <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-white mb-4">
        {title}
      </h2>
      {children}
    </div>
  );
}
