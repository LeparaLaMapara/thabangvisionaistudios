'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import {
  Users,
  Shield,
  ShieldCheck,
  User,
  Loader2,
  Ban,
  CheckCircle,
  X,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { useAdminUI } from '@/components/admin/shell/AdminUI';

type UserProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  is_verified: boolean;
  is_suspended: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  suspension_expires_at: string | null;
  email: string | null;
  created_at: string;
};

type ModerationEntry = {
  id: string;
  user_id: string;
  action: string;
  reason: string;
  admin_id: string;
  dispute_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type FilterTab = 'all' | 'active' | 'suspended';

const ROLE_LABELS: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  admin:     { label: 'Admin',     color: 'text-amber-400 bg-amber-500/10',   icon: ShieldCheck },
  moderator: { label: 'Moderator', color: 'text-blue-400 bg-blue-500/10',     icon: Shield },
  user:      { label: 'User',      color: 'text-neutral-400 bg-neutral-500/10', icon: User },
};

const DURATION_OPTIONS: { label: string; value: string }[] = [
  { label: 'Permanent', value: 'permanent' },
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: 'Custom', value: 'custom' },
];

function computeExpiresAt(duration: string, customDate: string): string | null {
  if (duration === 'permanent') return null;
  if (duration === 'custom') return customDate || null;
  const days = duration === '7d' ? 7 : 30;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export default function AdminUsersPage(): React.ReactElement {
  const ui = useAdminUI();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');

  // Suspend modal state
  const [suspendTarget, setSuspendTarget] = useState<UserProfile | null>(null);
  const [suspendReason, setSuspendReason] = useState<string>('');
  const [suspendDuration, setSuspendDuration] = useState<string>('permanent');
  const [suspendCustomDate, setSuspendCustomDate] = useState<string>('');
  const [suspendLoading, setSuspendLoading] = useState<boolean>(false);

  // Reinstate modal state
  const [reinstateTarget, setReinstateTarget] = useState<UserProfile | null>(null);
  const [reinstateReason, setReinstateReason] = useState<string>('');
  const [reinstateLoading, setReinstateLoading] = useState<boolean>(false);

  // Moderation history state
  const [historyTarget, setHistoryTarget] = useState<UserProfile | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ModerationEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  const fetchUsers = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch users');
      }
      const data: UserProfile[] = await res.json();
      setUsers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function changeRole(userId: string, newRole: string): Promise<void> {
    setUpdating(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      if (!res.ok) {
        const data = await res.json();
        ui.notify(data.error || 'Could not change the role.', 'bad');
        return;
      }

      setUsers(prev =>
        prev.map(u => (u.id === userId ? { ...u, role: newRole } : u)),
      );
    } catch {
      ui.notify('Could not change the role. Please try again.', 'bad');
    } finally {
      setUpdating(null);
    }
  }

  async function handleSuspend(): Promise<void> {
    if (!suspendTarget || !suspendReason.trim()) return;
    setSuspendLoading(true);

    try {
      const expiresAt = computeExpiresAt(suspendDuration, suspendCustomDate);
      const res = await fetch(`/api/admin/users/${suspendTarget.id}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: suspendReason.trim(),
          expires_at: expiresAt,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        ui.notify(data.error || 'Could not suspend this person.', 'bad');
        return;
      }

      setUsers(prev =>
        prev.map(u =>
          u.id === suspendTarget.id
            ? {
                ...u,
                is_suspended: true,
                suspended_at: new Date().toISOString(),
                suspension_reason: suspendReason.trim(),
                suspension_expires_at: expiresAt,
              }
            : u,
        ),
      );
      closeSuspendModal();
    } catch {
      ui.notify('Could not suspend this person. Please try again.', 'bad');
    } finally {
      setSuspendLoading(false);
    }
  }

  async function handleReinstate(): Promise<void> {
    if (!reinstateTarget || !reinstateReason.trim()) return;
    setReinstateLoading(true);

    try {
      const res = await fetch(`/api/admin/users/${reinstateTarget.id}/reinstate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reinstateReason.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        ui.notify(data.error || 'Could not restore this person.', 'bad');
        return;
      }

      setUsers(prev =>
        prev.map(u =>
          u.id === reinstateTarget.id
            ? {
                ...u,
                is_suspended: false,
                suspended_at: null,
                suspension_reason: null,
                suspension_expires_at: null,
              }
            : u,
        ),
      );
      closeReinstateModal();
    } catch {
      ui.notify('Could not restore this person. Please try again.', 'bad');
    } finally {
      setReinstateLoading(false);
    }
  }

  async function openHistory(user: UserProfile): Promise<void> {
    setHistoryTarget(user);
    setHistoryLoading(true);
    setHistoryEntries([]);

    try {
      const res = await fetch(`/api/admin/users/${user.id}/moderation-log`);
      if (res.ok) {
        const data: ModerationEntry[] = await res.json();
        setHistoryEntries(data);
      }
    } catch {
      // silently fail — empty history shown
    } finally {
      setHistoryLoading(false);
    }
  }

  function closeSuspendModal(): void {
    setSuspendTarget(null);
    setSuspendReason('');
    setSuspendDuration('permanent');
    setSuspendCustomDate('');
  }

  function closeReinstateModal(): void {
    setReinstateTarget(null);
    setReinstateReason('');
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-3 md:px-6 py-12 flex items-center justify-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
        <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
          Loading users...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-3 md:px-6 py-12">
        <div className="bg-red-500/10 border border-red-500/20 px-4 py-3">
          <p className="text-xs font-mono text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  const admins = users.filter(u => u.role === 'admin');
  const adminCount = admins.length;
  const suspendedCount = users.filter(u => u.is_suspended).length;

  const filteredUsers = users.filter(u => {
    if (filterTab === 'suspended') return u.is_suspended;
    if (filterTab === 'active') return !u.is_suspended;
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-6 py-6 md:py-12 space-y-8">
      {/* Header */}
      <div className="border-b border-white/5 pb-6">
        <div className="flex items-center gap-3 mb-2">
          <Users className="w-4 h-4 text-neutral-400" />
          <h1 className="text-xl font-display font-medium uppercase text-white tracking-wide">
            User Management
          </h1>
        </div>
        <p className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
          {users.length} users · {adminCount} admin{adminCount !== 1 ? 's' : ''} · {suspendedCount} suspended
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1">
        {(['all', 'active', 'suspended'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setFilterTab(tab)}
            className={`px-3 py-1.5 text-xs font-mono uppercase tracking-widest transition-colors ${
              filterTab === tab
                ? 'bg-white/10 text-white'
                : 'text-neutral-400 hover:text-neutral-400 hover:bg-white/[0.03]'
            }`}
          >
            {tab}
            {tab === 'suspended' && suspendedCount > 0 && (
              <span className="ml-1.5 text-red-400">({suspendedCount})</span>
            )}
          </button>
        ))}
      </div>

      {/* Users Table */}
      <div className="bg-neutral-900 border border-white/5 overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-[1fr_auto_auto_auto] md:grid-cols-[1fr_1fr_auto_auto_auto] gap-4 px-4 py-3 border-b border-white/[0.06] bg-neutral-900/50">
          <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
            User
          </span>
          <span className="text-xs font-mono uppercase tracking-widest text-neutral-400 hidden md:block">
            Email
          </span>
          <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
            Status
          </span>
          <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
            Role
          </span>
          <span className="text-xs font-mono uppercase tracking-widest text-neutral-400 text-right">
            Actions
          </span>
        </div>

        {/* User Rows */}
        {filteredUsers.map(user => {
          const roleInfo = ROLE_LABELS[user.role] || ROLE_LABELS.user;
          const RoleIcon = roleInfo.icon;
          const isUpdating = updating === user.id;

          return (
            <div
              key={user.id}
              className="grid grid-cols-[1fr_auto_auto_auto] md:grid-cols-[1fr_1fr_auto_auto_auto] gap-4 items-center px-4 py-3 border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.02] transition-colors"
            >
              {/* Name + avatar */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-7 h-7 rounded-full bg-neutral-800 flex-shrink-0 overflow-hidden flex items-center justify-center">
                  {user.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.avatar_url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-3 h-3 text-neutral-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-mono text-neutral-300 truncate">
                    {user.display_name || 'Unnamed'}
                  </p>
                  <p className="text-xs font-mono text-neutral-400 truncate md:hidden">
                    {user.email || '\u2014'}
                  </p>
                </div>
              </div>

              {/* Email (desktop) */}
              <p className="text-xs font-mono text-neutral-400 truncate hidden md:block">
                {user.email || '\u2014'}
              </p>

              {/* Suspension status */}
              <div className="flex-shrink-0">
                {user.is_suspended ? (
                  <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono uppercase tracking-widest text-red-400 bg-red-500/10">
                    <Ban className="w-2.5 h-2.5" />
                    Suspended
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono uppercase tracking-widest text-emerald-400 bg-emerald-500/10">
                    <CheckCircle className="w-2.5 h-2.5" />
                    Active
                  </span>
                )}
              </div>

              {/* Role badge */}
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs font-mono uppercase tracking-widest flex-shrink-0 ${roleInfo.color}`}
              >
                <RoleIcon className="w-2.5 h-2.5" />
                {roleInfo.label}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {isUpdating ? (
                  <Loader2 className="w-3 h-3 animate-spin text-neutral-400" />
                ) : (
                  <>
                    <select
                      value={user.role}
                      onChange={e => changeRole(user.id, e.target.value)}
                      className="bg-neutral-800 border border-white/10 text-xs font-mono text-neutral-400 px-2 py-1 appearance-none cursor-pointer hover:border-white/20 transition-colors focus:outline-none focus:border-amber-500/50"
                    >
                      <option value="user">User</option>
                      <option value="moderator">Moderator</option>
                      <option value="admin">Admin</option>
                    </select>

                    {user.is_suspended ? (
                      <button
                        onClick={() => setReinstateTarget(user)}
                        className="px-2 py-1 text-xs font-mono uppercase tracking-widest text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
                        title="Reinstate user"
                      >
                        Reinstate
                      </button>
                    ) : (
                      <button
                        onClick={() => setSuspendTarget(user)}
                        className="px-2 py-1 text-xs font-mono uppercase tracking-widest text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                        title="Suspend user"
                      >
                        Suspend
                      </button>
                    )}

                    <button
                      onClick={() => openHistory(user)}
                      className="px-2 py-1 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-neutral-300 hover:bg-white/[0.05] transition-colors"
                      title="View moderation history"
                    >
                      History
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {filteredUsers.length === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
              No users found.
            </p>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="bg-neutral-900/50 border border-white/5 px-4 py-3 space-y-1">
        <p className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
          Role permissions
        </p>
        <ul className="text-xs font-mono text-neutral-400 space-y-0.5">
          <li>
            <span className="text-amber-400/60">Admin</span> — Full access to all admin features and user management
          </li>
          <li>
            <span className="text-blue-400/60">Moderator</span> — Can manage content but cannot change user roles
          </li>
          <li>
            <span className="text-neutral-400">User</span> — Standard platform access
          </li>
        </ul>
      </div>

      {/* ── Suspend Modal ─────────────────────────────────────────────────────── */}
      {suspendTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-white/10 w-full max-w-md mx-4 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <h2 className="text-sm font-mono uppercase tracking-widest text-white">
                  Suspend User
                </h2>
              </div>
              <button
                onClick={closeSuspendModal}
                className="text-neutral-400 hover:text-neutral-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs font-mono text-neutral-400">
              Suspending <span className="text-neutral-300">{suspendTarget.display_name || suspendTarget.email || 'this user'}</span>.
              Their listings will be deactivated.
            </p>

            {/* Reason */}
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                Reason (required)
              </label>
              <textarea
                value={suspendReason}
                onChange={e => setSuspendReason(e.target.value)}
                placeholder="Describe the reason for suspension..."
                rows={3}
                className="w-full bg-neutral-800 border border-white/10 text-xs font-mono text-neutral-300 px-3 py-2 placeholder-neutral-700 focus:outline-none focus:border-amber-500/50 resize-none"
              />
            </div>

            {/* Duration */}
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                Duration
              </label>
              <div className="flex gap-1 flex-wrap">
                {DURATION_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setSuspendDuration(opt.value)}
                    className={`px-3 py-1 text-xs font-mono uppercase tracking-widest transition-colors ${
                      suspendDuration === opt.value
                        ? 'bg-white/10 text-white'
                        : 'text-neutral-400 hover:text-neutral-400 bg-neutral-800'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {suspendDuration === 'custom' && (
                <input
                  type="datetime-local"
                  value={suspendCustomDate}
                  onChange={e => setSuspendCustomDate(e.target.value)}
                  className="w-full bg-neutral-800 border border-white/10 text-xs font-mono text-neutral-300 px-3 py-2 focus:outline-none focus:border-amber-500/50 mt-2"
                />
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleSuspend}
                disabled={!suspendReason.trim() || suspendLoading}
                className="flex-1 px-4 py-2 text-xs font-mono uppercase tracking-widest bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {suspendLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                Confirm Suspension
              </button>
              <button
                onClick={closeSuspendModal}
                className="px-4 py-2 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-neutral-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reinstate Modal ───────────────────────────────────────────────────── */}
      {reinstateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-white/10 w-full max-w-md mx-4 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-mono uppercase tracking-widest text-white">
                  Reinstate User
                </h2>
              </div>
              <button
                onClick={closeReinstateModal}
                className="text-neutral-400 hover:text-neutral-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs font-mono text-neutral-400">
              Reinstating <span className="text-neutral-300">{reinstateTarget.display_name || reinstateTarget.email || 'this user'}</span>.
              {reinstateTarget.suspension_reason && (
                <span className="block mt-1 text-red-400/60">
                  Suspended for: {reinstateTarget.suspension_reason}
                </span>
              )}
            </p>

            {/* Reason */}
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                Reason (required)
              </label>
              <textarea
                value={reinstateReason}
                onChange={e => setReinstateReason(e.target.value)}
                placeholder="Describe why this user is being reinstated..."
                rows={3}
                className="w-full bg-neutral-800 border border-white/10 text-xs font-mono text-neutral-300 px-3 py-2 placeholder-neutral-700 focus:outline-none focus:border-amber-500/50 resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleReinstate}
                disabled={!reinstateReason.trim() || reinstateLoading}
                className="flex-1 px-4 py-2 text-xs font-mono uppercase tracking-widest bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {reinstateLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                Confirm Reinstatement
              </button>
              <button
                onClick={closeReinstateModal}
                className="px-4 py-2 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-neutral-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Moderation History Modal ──────────────────────────────────────────── */}
      {historyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-white/10 w-full max-w-lg mx-4 p-6 space-y-5 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-neutral-400" />
                <h2 className="text-sm font-mono uppercase tracking-widest text-white">
                  Moderation History
                </h2>
              </div>
              <button
                onClick={() => setHistoryTarget(null)}
                className="text-neutral-400 hover:text-neutral-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs font-mono text-neutral-400">
              {historyTarget.display_name || historyTarget.email || 'User'} — {historyTarget.id}
            </p>

            {historyLoading ? (
              <div className="flex items-center justify-center py-8 gap-2">
                <Loader2 className="w-3 h-3 animate-spin text-neutral-400" />
                <span className="text-xs font-mono text-neutral-400">Loading...</span>
              </div>
            ) : historyEntries.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
                  No moderation history.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {historyEntries.map(entry => (
                  <div
                    key={entry.id}
                    className="border border-white/[0.04] bg-neutral-800/50 px-3 py-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-mono uppercase tracking-widest ${
                          entry.action === 'suspended'
                            ? 'text-red-400'
                            : entry.action === 'reinstated'
                              ? 'text-emerald-400'
                              : 'text-amber-400'
                        }`}
                      >
                        {entry.action.replace('_', ' ')}
                      </span>
                      <span className="text-xs font-mono text-neutral-400">
                        {new Date(entry.created_at).toLocaleDateString('en-ZA', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-xs font-mono text-neutral-400">
                      {entry.reason}
                    </p>
                    <p className="text-xs font-mono text-neutral-400">
                      Admin: {entry.admin_id}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2">
              <button
                onClick={() => setHistoryTarget(null)}
                className="w-full px-4 py-2 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-neutral-300 hover:bg-white/[0.03] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
