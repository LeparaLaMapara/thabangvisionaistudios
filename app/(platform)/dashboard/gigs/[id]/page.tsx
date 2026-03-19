export const dynamic = 'force-dynamic';

import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ArrowLeft, Calendar, MapPin, Briefcase, Clock } from 'lucide-react';
import GigActions from './GigActions';

export const metadata = { title: 'Gig Details' };

export default async function GigDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await auth.getUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const supabase = await createClient();

  // Fetch gig -- creator can only see their own
  // Do NOT select client_email or client_phone (privacy)
  const { data: gig, error } = await supabase
    .from('crew_requests')
    .select('id, creator_id, client_name, project_type, preferred_dates, description, budget_range, location, duration, status, booked_via, total_amount, commission_amount, created_at, updated_at')
    .eq('id', id)
    .eq('creator_id', user.id)
    .single();

  if (error || !gig) notFound();

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

  // Calculate creator earnings (total - commission)
  const earnings = gig.total_amount && gig.commission_amount
    ? gig.total_amount - gig.commission_amount
    : null;

  return (
    <div>
      <Link
        href="/dashboard/gigs"
        className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-white mb-8 transition-colors"
      >
        <ArrowLeft className="w-3 h-3" /> Back to gigs
      </Link>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className="text-lg font-display font-medium uppercase text-white">
            {gig.project_type}
          </h2>
          <p className="text-[10px] font-mono text-neutral-500 mt-1">
            Ref: {gig.id.slice(0, 8).toUpperCase()} -- via {gig.booked_via}
          </p>
        </div>
        <span className={`inline-block text-[9px] font-mono uppercase tracking-widest border px-3 py-1 ${statusColors[gig.status] || 'text-neutral-400 border-white/10'}`}>
          {gig.status}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Client info (name only, no email/phone) */}
        <div className="bg-[#0A0A0B] border border-white/5 p-5">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-4">Client</h3>
          <p className="text-sm font-mono text-white">{gig.client_name}</p>
          <p className="text-[10px] font-mono text-neutral-600 mt-2">
            Contact details are managed by ThabangVision for privacy.
          </p>
        </div>

        {/* Project details */}
        <div className="bg-[#0A0A0B] border border-white/5 p-5">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-4">Details</h3>
          <div className="space-y-3 text-xs font-mono">
            {gig.preferred_dates && (
              <div className="flex items-center gap-2 text-neutral-300">
                <Calendar className="w-3 h-3 text-neutral-500" /> {gig.preferred_dates}
              </div>
            )}
            {gig.location && (
              <div className="flex items-center gap-2 text-neutral-300">
                <MapPin className="w-3 h-3 text-neutral-500" /> {gig.location}
              </div>
            )}
            {gig.budget_range && (
              <div className="flex items-center gap-2 text-neutral-300">
                <Briefcase className="w-3 h-3 text-neutral-500" /> {gig.budget_range}
              </div>
            )}
            {gig.duration && (
              <div className="flex items-center gap-2 text-neutral-300">
                <Clock className="w-3 h-3 text-neutral-500" /> {gig.duration}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="bg-[#0A0A0B] border border-white/5 p-5 mt-6">
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">Description</h3>
        <p className="text-xs font-mono text-neutral-300 leading-relaxed whitespace-pre-wrap">
          {gig.description}
        </p>
      </div>

      {/* Earnings breakdown (only if total_amount exists) */}
      {gig.total_amount && (
        <div className="bg-[#0A0A0B] border border-white/5 p-5 mt-6">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">Earnings</h3>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-neutral-400">Total</span>
              <span className="text-white">R{gig.total_amount.toLocaleString()}</span>
            </div>
            {gig.commission_amount && (
              <>
                <div className="flex justify-between">
                  <span className="text-neutral-400">Platform fee (15%)</span>
                  <span className="text-neutral-500">-R{gig.commission_amount.toLocaleString()}</span>
                </div>
                <div className="border-t border-white/5 pt-2 flex justify-between">
                  <span className="text-neutral-400">Your earnings</span>
                  <span className="text-emerald-400 font-bold">R{earnings?.toLocaleString()}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <GigActions gigId={gig.id} status={gig.status} />

      {/* Timeline */}
      <div className="bg-[#0A0A0B] border border-white/5 p-5 mt-6">
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">Timeline</h3>
        <div className="space-y-2 text-[10px] font-mono text-neutral-500">
          <p>Submitted: {new Date(gig.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
          {gig.updated_at !== gig.created_at && (
            <p>Last updated: {new Date(gig.updated_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
          )}
        </div>
      </div>
    </div>
  );
}
