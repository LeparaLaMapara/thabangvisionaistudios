'use client';

import { useState } from 'react';
import { MapPin, Calendar, Mail, Phone, Briefcase, MessageSquare } from 'lucide-react';
import { STUDIO } from '@/lib/constants';
import type { CrewRequest } from '@/lib/supabase/queries/crew';

const TABS = ['all', 'pending', 'contacted', 'confirmed', 'completed', 'declined'] as const;

interface Props {
  initialRequests: CrewRequest[];
}

export default function CreatorRequestsManager({ initialRequests }: Props) {
  const [requests, setRequests] = useState(initialRequests);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const filtered = activeTab === 'all' ? requests : requests.filter((r) => r.status === activeTab);

  const counts: Record<string, number> = {};
  for (const tab of TABS) {
    counts[tab] = tab === 'all' ? requests.length : requests.filter((r) => r.status === tab).length;
  }

  const updateStatus = async (id: string, status: string) => {
    setUpdating(id);
    try {
      const res = await fetch(`/api/admin/creator-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status, admin_notes: notes[id] || undefined }),
      });

      if (res.ok) {
        setRequests((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, status, admin_notes: notes[id] || r.admin_notes, updated_at: new Date().toISOString() }
              : r,
          ),
        );
      }
    } catch {
      // Silently fail
    } finally {
      setUpdating(null);
    }
  };

  return (
    <>
      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-[10px] font-mono uppercase tracking-widest px-3 py-2 border transition-all min-h-[36px] ${
              activeTab === tab
                ? 'bg-white text-black border-white'
                : 'bg-transparent text-neutral-500 border-white/10 hover:border-white/30'
            }`}
          >
            {STUDIO.creators.statusLabels[tab as keyof typeof STUDIO.creators.statusLabels] || 'All'}
            {counts[tab] > 0 && <span className="ml-1">({counts[tab]})</span>}
          </button>
        ))}
      </div>

      {/* Requests */}
      {filtered.length > 0 ? (
        <div className="space-y-4">
          {filtered.map((req) => {
            const isExpanded = expandedId === req.id;
            const creator = req.creator as unknown as {
              display_name?: string;
              phone?: string;
              hourly_rate?: number;
              specializations?: string[];
            } | null;

            return (
              <div key={req.id} className="bg-[#0A0A0B] border border-white/5">
                {/* Header row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : req.id)}
                  className="w-full text-left p-5 flex items-start justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-mono font-bold text-white uppercase">
                        {req.project_type}
                      </h3>
                      <StatusBadge status={req.status} />
                      <span className="text-[9px] font-mono text-neutral-600">via {req.booked_via}</span>
                    </div>
                    <p className="text-xs font-mono text-neutral-400 mt-1">
                      {req.client_name} &mdash;{' '}
                      {new Date(req.created_at).toLocaleDateString('en-ZA', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-neutral-600">
                    {isExpanded ? '—' : '+'}
                  </span>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-white/5 pt-4 space-y-5">
                    {/* Client info */}
                    <div>
                      <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                        Client
                      </p>
                      <div className="space-y-1 text-xs font-mono text-neutral-300">
                        <p>{req.client_name}</p>
                        <p className="flex items-center gap-1.5">
                          <Mail className="w-3 h-3 text-neutral-500" />
                          <a href={`mailto:${req.client_email}`} className="text-[#D4A843] hover:underline">
                            {req.client_email}
                          </a>
                        </p>
                        {req.client_phone && (
                          <p className="flex items-center gap-1.5">
                            <Phone className="w-3 h-3 text-neutral-500" />
                            <a href={`tel:${req.client_phone}`} className="hover:underline">
                              {req.client_phone}
                            </a>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Creator info */}
                    {creator && (
                      <div>
                        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                          Requested Creator
                        </p>
                        <div className="space-y-1 text-xs font-mono text-neutral-300">
                          <p>{creator.display_name}</p>
                          {creator.phone && (
                            <p className="flex items-center gap-1.5">
                              <Phone className="w-3 h-3 text-neutral-500" /> {creator.phone}
                            </p>
                          )}
                          {creator.hourly_rate && (
                            <p>{STUDIO.currency.symbol}{creator.hourly_rate}/hr</p>
                          )}
                          {creator.specializations && (
                            <p className="text-neutral-500">{creator.specializations.join(', ')}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Project details */}
                    <div>
                      <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                        Project
                      </p>
                      <p className="text-xs font-mono text-neutral-300 leading-relaxed mb-2">
                        {req.description}
                      </p>
                      <div className="flex flex-wrap gap-3 text-[10px] font-mono text-neutral-500">
                        {req.preferred_dates && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> {req.preferred_dates}
                          </span>
                        )}
                        {req.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {req.location}
                          </span>
                        )}
                        {req.budget_range && (
                          <span className="flex items-center gap-1">
                            <Briefcase className="w-3 h-3" /> {req.budget_range}
                          </span>
                        )}
                        {req.duration && <span>{req.duration}</span>}
                      </div>
                    </div>

                    {/* Admin notes */}
                    <div>
                      <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2 flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" /> Admin Notes
                      </p>
                      <textarea
                        value={notes[req.id] ?? req.admin_notes ?? ''}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [req.id]: e.target.value }))}
                        placeholder="Add notes about this request..."
                        rows={3}
                        className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 text-xs font-mono placeholder:text-neutral-700 focus:outline-none focus:border-white transition-colors resize-none"
                      />
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      {req.status === 'pending' && (
                        <>
                          <ActionButton
                            label="Mark Contacted"
                            onClick={() => updateStatus(req.id, 'contacted')}
                            loading={updating === req.id}
                            color="blue"
                          />
                          <ActionButton
                            label="Confirm"
                            onClick={() => updateStatus(req.id, 'confirmed')}
                            loading={updating === req.id}
                            color="green"
                          />
                          <ActionButton
                            label="Decline"
                            onClick={() => updateStatus(req.id, 'declined')}
                            loading={updating === req.id}
                            color="red"
                          />
                        </>
                      )}
                      {req.status === 'contacted' && (
                        <>
                          <ActionButton
                            label="Confirm"
                            onClick={() => updateStatus(req.id, 'confirmed')}
                            loading={updating === req.id}
                            color="green"
                          />
                          <ActionButton
                            label="Decline"
                            onClick={() => updateStatus(req.id, 'declined')}
                            loading={updating === req.id}
                            color="red"
                          />
                        </>
                      )}
                      {req.status === 'confirmed' && (
                        <ActionButton
                          label="Mark Completed"
                          onClick={() => updateStatus(req.id, 'completed')}
                          loading={updating === req.id}
                          color="green"
                        />
                      )}
                      {(req.status === 'confirmed' || req.status === 'contacted') && (
                        <ActionButton
                          label="Cancel"
                          onClick={() => updateStatus(req.id, 'cancelled')}
                          loading={updating === req.id}
                          color="red"
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 text-neutral-500">
          <p className="text-sm font-mono">No requests found.</p>
        </div>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'text-amber-400 border-amber-500/30',
    contacted: 'text-blue-400 border-blue-500/30',
    confirmed: 'text-emerald-400 border-emerald-500/30',
    completed: 'text-neutral-400 border-neutral-500/30',
    declined: 'text-red-400 border-red-500/30',
    cancelled: 'text-neutral-500 border-neutral-600/30',
  };

  const label =
    STUDIO.creators.statusLabels[status as keyof typeof STUDIO.creators.statusLabels] || status;

  return (
    <span
      className={`text-[8px] font-mono uppercase tracking-widest border px-2 py-0.5 ${colors[status] || 'text-neutral-400 border-white/10'}`}
    >
      {label}
    </span>
  );
}

function ActionButton({
  label,
  onClick,
  loading,
  color,
}: {
  label: string;
  onClick: () => void;
  loading: boolean;
  color: 'green' | 'red' | 'blue';
}) {
  const colorClasses = {
    green: 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10',
    red: 'border-red-500/30 text-red-400 hover:bg-red-500/10',
    blue: 'border-blue-500/30 text-blue-400 hover:bg-blue-500/10',
  };

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`text-[10px] font-mono uppercase tracking-widest border px-4 py-2 min-h-[36px] transition-colors disabled:opacity-40 ${colorClasses[color]}`}
    >
      {loading ? 'Updating...' : label}
    </button>
  );
}
