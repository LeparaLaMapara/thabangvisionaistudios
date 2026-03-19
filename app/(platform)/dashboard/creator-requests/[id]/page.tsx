export const dynamic = 'force-dynamic';

import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ArrowLeft, Calendar, MapPin, Briefcase, Clock } from 'lucide-react';
import PayButton from './PayButton';

export const metadata = { title: 'Request Details' };

export default async function CreatorRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await auth.getUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  // Fetch request with creator info
  const { data: request, error } = await supabase
    .from('crew_requests')
    .select(`
      *,
      creator:profiles!creator_id (
        id, display_name, crew_slug, avatar_url, specializations, hourly_rate, location
      )
    `)
    .eq('id', id)
    .single();

  if (error || !request) notFound();

  // Auth: only the client who made this request can see it
  if (authUser?.email !== request.client_email) notFound();

  const creator = request.creator as {
    id: string;
    display_name: string | null;
    crew_slug: string | null;
    avatar_url: string | null;
    specializations: string[] | null;
    hourly_rate: number | null;
    location: string | null;
  } | null;

  const statusColors: Record<string, string> = {
    pending: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    contacted: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
    confirmed: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    paid: 'text-green-400 border-green-500/30 bg-green-500/10',
    in_progress: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10',
    completed: 'text-neutral-400 border-neutral-500/30 bg-neutral-500/10',
    declined: 'text-red-400 border-red-500/30 bg-red-500/10',
    cancelled: 'text-neutral-500 border-neutral-600/30 bg-neutral-600/10',
  };

  return (
    <div>
      {/* Back link */}
      <Link
        href="/dashboard/creator-requests"
        className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-white mb-8 transition-colors"
      >
        <ArrowLeft className="w-3 h-3" /> Back to requests
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className="text-lg font-display font-medium uppercase text-white">
            {request.project_type}
          </h2>
          <p className="text-[10px] font-mono text-neutral-500 mt-1">
            Ref: {request.id.slice(0, 8).toUpperCase()}
          </p>
        </div>
        <span className={`inline-block text-[9px] font-mono uppercase tracking-widest border px-3 py-1 ${statusColors[request.status] || 'text-neutral-400 border-white/10'}`}>
          {request.status}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Creator info card */}
        <div className="bg-[#0A0A0B] border border-white/5 p-5">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-4">Creator</h3>
          <div className="flex items-center gap-3 mb-3">
            {creator?.avatar_url ? (
              <img src={creator.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-xs font-mono text-neutral-400">
                {(creator?.display_name || '?')[0]}
              </div>
            )}
            <div>
              <Link
                href={`/smart-creators/${creator?.crew_slug || creator?.id}`}
                className="text-sm font-mono text-white hover:text-[#D4A843] transition-colors"
              >
                {creator?.display_name || 'Unknown'}
              </Link>
              <p className="text-[10px] font-mono text-neutral-500">
                {creator?.specializations?.join(', ') || 'General'}
              </p>
            </div>
          </div>
          {creator?.hourly_rate && (
            <p className="text-xs font-mono text-neutral-400">Rate: R{creator.hourly_rate}/hr</p>
          )}
          {creator?.location && (
            <p className="text-xs font-mono text-neutral-400 flex items-center gap-1 mt-1">
              <MapPin className="w-3 h-3" /> {creator.location}
            </p>
          )}
        </div>

        {/* Request details card */}
        <div className="bg-[#0A0A0B] border border-white/5 p-5">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-4">Details</h3>
          <div className="space-y-3 text-xs font-mono">
            {request.preferred_dates && (
              <div className="flex items-center gap-2 text-neutral-300">
                <Calendar className="w-3 h-3 text-neutral-500" /> {request.preferred_dates}
              </div>
            )}
            {request.location && (
              <div className="flex items-center gap-2 text-neutral-300">
                <MapPin className="w-3 h-3 text-neutral-500" /> {request.location}
              </div>
            )}
            {request.budget_range && (
              <div className="flex items-center gap-2 text-neutral-300">
                <Briefcase className="w-3 h-3 text-neutral-500" /> {request.budget_range}
              </div>
            )}
            {request.duration && (
              <div className="flex items-center gap-2 text-neutral-300">
                <Clock className="w-3 h-3 text-neutral-500" /> {request.duration}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="bg-[#0A0A0B] border border-white/5 p-5 mt-6">
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">Description</h3>
        <p className="text-xs font-mono text-neutral-300 leading-relaxed whitespace-pre-wrap">
          {request.description}
        </p>
      </div>

      {/* Payment section -- show if confirmed and total_amount is set */}
      {request.status === 'confirmed' && request.total_amount > 0 && (
        <PayButton requestId={request.id} amount={request.total_amount} />
      )}

      {/* Amount info if paid */}
      {(request.status === 'paid' || request.status === 'in_progress' || request.status === 'completed') && request.total_amount && (
        <div className="bg-[#0A0A0B] border border-white/5 p-5 mt-6">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">Payment</h3>
          <p className="text-sm font-mono text-emerald-400">R{request.total_amount.toLocaleString()} -- Paid</p>
        </div>
      )}

      {/* Timeline */}
      <div className="bg-[#0A0A0B] border border-white/5 p-5 mt-6">
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">Timeline</h3>
        <div className="space-y-2 text-[10px] font-mono text-neutral-500">
          <p>Submitted: {new Date(request.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
          {request.updated_at !== request.created_at && (
            <p>Last updated: {new Date(request.updated_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
          )}
          <p>Booked via: {request.booked_via}</p>
        </div>
      </div>
    </div>
  );
}
