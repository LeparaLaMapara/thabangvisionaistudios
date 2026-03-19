'use client';

import { useState, useEffect } from 'react';
import { Loader2, CheckCircle, Building2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SA_BANKS } from '@/lib/constants';

type BankingData = {
  bank_name: string;
  bank_code: string;
  account_number: string;
  account_type: string;
  account_holder: string;
  paystack_recipient_code: string | null;
};

export default function BankingDetails({ onSaved }: { onSaved?: () => void } = {}) {
  const [banking, setBanking] = useState<BankingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form fields
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountType, setAccountType] = useState('cheque');
  const [accountHolder, setAccountHolder] = useState('');

  useEffect(() => {
    fetchBanking();
  }, []);

  async function fetchBanking(): Promise<void> {
    try {
      const res = await fetch('/api/banking');
      if (res.ok) {
        const data = await res.json();
        setBanking(data);
      }
    } catch {
      // Silently handle fetch errors
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (!bankCode || !accountNumber || !accountHolder) {
      setMessage({ type: 'error', text: 'All fields are required.' });
      return;
    }

    const bank = SA_BANKS.find(b => b.code === bankCode);
    if (!bank) {
      setMessage({ type: 'error', text: 'Please select a valid bank.' });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/banking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bank_name: bank.name,
          bank_code: bankCode,
          account_number: accountNumber,
          account_type: accountType,
          account_holder: accountHolder,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to save.' });
      } else {
        setMessage({ type: 'success', text: 'Banking details saved.' });
        setEditing(false);
        fetchBanking();
        onSaved?.();
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save banking details.' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-neutral-500 text-xs font-mono">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading...
      </div>
    );
  }

  // Show existing details (masked)
  if (banking && !editing) {
    return (
      <div className="bg-[#0A0A0B] border border-white/5 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-neutral-500" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
              Banking Details
            </span>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-[10px] font-mono uppercase tracking-widest text-[#D4A843] hover:text-[#E5B954] transition-colors"
          >
            Edit
          </button>
        </div>
        <div className="space-y-2 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-neutral-500">Bank</span>
            <span className="text-white">{banking.bank_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Account</span>
            <span className="text-white">{banking.account_number}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Type</span>
            <span className="text-white capitalize">{banking.account_type}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Holder</span>
            <span className="text-white">{banking.account_holder}</span>
          </div>
        </div>
        {banking.paystack_recipient_code && (
          <div className="flex items-center gap-1.5 mt-3 text-[9px] font-mono text-emerald-400">
            <CheckCircle className="w-3 h-3" /> Linked for payouts
          </div>
        )}
      </div>
    );
  }

  // Edit/add form
  return (
    <div className="bg-[#0A0A0B] border border-white/5 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Building2 className="w-4 h-4 text-neutral-500" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
          Banking Details
        </span>
      </div>

      <p className="text-[10px] font-mono text-neutral-600 mb-4">
        Required for receiving payouts from gig bookings.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
            Bank <span className="text-red-400">*</span>
          </label>
          <select
            value={bankCode}
            onChange={(e) => setBankCode(e.target.value)}
            className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono focus:outline-none focus:border-white transition-colors"
          >
            <option value="">Select bank...</option>
            {SA_BANKS.map((bank) => (
              <option key={bank.code} value={bank.code}>{bank.name}</option>
            ))}
          </select>
        </div>

        <Input
          label="Account Number"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
          placeholder="Account number"
          required
        />

        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
            Account Type <span className="text-red-400">*</span>
          </label>
          <div className="flex gap-3">
            {(['cheque', 'savings'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setAccountType(type)}
                className={`text-[10px] font-mono uppercase tracking-widest px-4 py-2 border transition-all min-h-[36px] ${
                  accountType === type
                    ? 'bg-white text-black border-white'
                    : 'bg-transparent text-neutral-500 border-white/10 hover:border-white/30'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <Input
          label="Account Holder Name"
          value={accountHolder}
          onChange={(e) => setAccountHolder(e.target.value)}
          placeholder="Full name as on bank account"
          required
        />

        {message && (
          <div className={`text-xs font-mono px-3 py-2 border ${
            message.type === 'success'
              ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
              : 'text-red-400 border-red-500/30 bg-red-500/10'
          }`}>
            {message.text}
          </div>
        )}

        <div className="flex gap-3">
          <Button onClick={handleSave} loading={saving}>
            Save Banking Details
          </Button>
          {banking && (
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
