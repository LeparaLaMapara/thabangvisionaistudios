'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { Users, Shield, ShieldCheck, User, Loader2 } from 'lucide-react';

type UserProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  is_verified: boolean;
  email: string | null;
  created_at: string;
};

const ROLE_LABELS: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  admin:     { label: 'Admin',     color: 'text-amber-400 bg-amber-500/10',   icon: ShieldCheck },
  moderator: { label: 'Moderator', color: 'text-blue-400 bg-blue-500/10',     icon: Shield },
  user:      { label: 'User',      color: 'text-neutral-400 bg-neutral-500/10', icon: User },
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch users');
      }
      const data = await res.json();
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

  async function changeRole(userId: string, newRole: string) {
    setUpdating(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to update role');
        return;
      }

      // Update local state
      setUsers(prev =>
        prev.map(u => (u.id === userId ? { ...u, role: newRole } : u)),
      );
    } catch {
      alert('Failed to update role. Please try again.');
    } finally {
      setUpdating(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-3 md:px-6 py-12 flex items-center justify-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-neutral-500" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-600">
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

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-6 py-6 md:py-12 space-y-8">
      {/* Header */}
      <div className="border-b border-white/5 pb-6">
        <div className="flex items-center gap-3 mb-2">
          <Users className="w-4 h-4 text-neutral-600" />
          <h1 className="text-xl font-display font-medium uppercase text-white tracking-wide">
            User Management
          </h1>
        </div>
        <p className="text-[10px] font-mono text-neutral-600 uppercase tracking-widest">
          {users.length} users · {adminCount} admin{adminCount !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Users Table */}
      <div className="bg-neutral-900 border border-white/5 overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-[1fr_auto_auto_auto] md:grid-cols-[1fr_1fr_auto_auto] gap-4 px-4 py-3 border-b border-white/[0.06] bg-neutral-900/50">
          <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-600">
            User
          </span>
          <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 hidden md:block">
            Email
          </span>
          <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-600">
            Role
          </span>
          <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 text-right">
            Actions
          </span>
        </div>

        {/* User Rows */}
        {users.map(user => {
          const roleInfo = ROLE_LABELS[user.role] || ROLE_LABELS.user;
          const RoleIcon = roleInfo.icon;
          const isUpdating = updating === user.id;

          return (
            <div
              key={user.id}
              className="grid grid-cols-[1fr_auto_auto_auto] md:grid-cols-[1fr_1fr_auto_auto] gap-4 items-center px-4 py-3 border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.02] transition-colors"
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
                    <User className="w-3 h-3 text-neutral-600" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-mono text-neutral-300 truncate">
                    {user.display_name || 'Unnamed'}
                  </p>
                  <p className="text-[10px] font-mono text-neutral-700 truncate md:hidden">
                    {user.email || '—'}
                  </p>
                </div>
              </div>

              {/* Email (desktop) */}
              <p className="text-[10px] font-mono text-neutral-600 truncate hidden md:block">
                {user.email || '—'}
              </p>

              {/* Role badge */}
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-1 text-[9px] font-mono uppercase tracking-widest flex-shrink-0 ${roleInfo.color}`}
              >
                <RoleIcon className="w-2.5 h-2.5" />
                {roleInfo.label}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {isUpdating ? (
                  <Loader2 className="w-3 h-3 animate-spin text-neutral-500" />
                ) : (
                  <select
                    value={user.role}
                    onChange={e => changeRole(user.id, e.target.value)}
                    className="bg-neutral-800 border border-white/10 text-[10px] font-mono text-neutral-400 px-2 py-1 appearance-none cursor-pointer hover:border-white/20 transition-colors focus:outline-none focus:border-amber-500/50"
                  >
                    <option value="user">User</option>
                    <option value="moderator">Moderator</option>
                    <option value="admin">Admin</option>
                  </select>
                )}
              </div>
            </div>
          );
        })}

        {users.length === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-[10px] font-mono text-neutral-700 uppercase tracking-widest">
              No users found.
            </p>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="bg-neutral-900/50 border border-white/5 px-4 py-3 space-y-1">
        <p className="text-[9px] font-mono text-neutral-600 uppercase tracking-widest">
          Role permissions
        </p>
        <ul className="text-[10px] font-mono text-neutral-700 space-y-0.5">
          <li>
            <span className="text-amber-400/60">Admin</span> — Full access to all admin features and user management
          </li>
          <li>
            <span className="text-blue-400/60">Moderator</span> — Can manage content but cannot change user roles
          </li>
          <li>
            <span className="text-neutral-500">User</span> — Standard platform access
          </li>
        </ul>
      </div>
    </div>
  );
}
