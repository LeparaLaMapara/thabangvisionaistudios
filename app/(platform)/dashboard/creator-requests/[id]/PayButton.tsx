'use client';

import { useState } from 'react';

export default function PayButton({ requestId, amount }: { requestId: string; amount: number }) {
  const [loading, setLoading] = useState(false);

  async function handlePay() {
    setLoading(true);
    try {
      const res = await fetch(`/api/creator-requests/${requestId}/pay`, { method: 'POST' });
      const data = await res.json();
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
      }
    } catch {
      // Payment error
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#0A0A0B] border border-white/5 p-5 mt-6">
      <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">Payment Required</h3>
      <p className="text-sm font-mono text-white mb-4">Total: R{amount.toLocaleString()}</p>
      <button
        onClick={handlePay}
        disabled={loading}
        className="text-[10px] font-mono uppercase tracking-widest px-6 py-2.5 bg-[#D4A843] text-black hover:bg-[#E5B954] transition-colors disabled:opacity-50"
      >
        {loading ? 'Processing...' : 'Pay Now'}
      </button>
    </div>
  );
}
