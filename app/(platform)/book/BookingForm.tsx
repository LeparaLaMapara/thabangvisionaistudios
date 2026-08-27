'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Clock, MapPin, Camera, Package } from 'lucide-react';

const DELIVERABLES = [
  'Edited Photos (Digital)',
  'Edited Video',
  'Photos + Video',
  'Raw Files',
  'Social Media Cuts',
  'All of the Above',
];

const CATEGORIES = [
  'Portrait Photography',
  'Wedding Photography',
  'Wedding Cinematography',
  'Corporate Photography',
  'Corporate Video',
  'Music Video',
  'Event Coverage',
  'Product Photography',
  'Real Estate Photography',
  'Content Creation',
  'Documentary',
  'Short Film',
];

interface BookingFormProps {
  creatorId: string | null;
  creatorName: string | null;
  creatorRate: number | null;
  creatorSpecializations: string[];
  initialCategory: string;
  initialHours: number;
  initialLocation: string;
  initialDates: string;
  hourlyRate: number;
  vatRate: number;
  minHours: number;
  maxHours: number;
}

export function BookingForm({
  creatorId,
  creatorName,
  creatorRate,
  creatorSpecializations,
  initialCategory,
  initialHours,
  initialLocation,
  initialDates,
  hourlyRate: defaultRate,
  vatRate,
  minHours,
  maxHours,
}: BookingFormProps) {
  const router = useRouter();
  const [category, setCategory] = useState(initialCategory);
  const [hours, setHours] = useState(initialHours);
  const [date, setDate] = useState(initialDates);
  const [location, setLocation] = useState(initialLocation);
  const [deliverables, setDeliverables] = useState('');

  const rate = creatorRate ?? defaultRate;

  const quote = useMemo(() => {
    if (!hours || hours < minHours) return null;
    const subtotal = Math.round(rate * hours);
    const vat = Math.round(subtotal * (vatRate / 100));
    return { subtotal, vat, total: subtotal + vat };
  }, [rate, hours, vatRate, minHours]);

  const canSubmit = category && hours >= minHours && date;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const params = new URLSearchParams({
      category,
      hours: String(hours),
      dates: date,
      ...(location && { location }),
      ...(deliverables && { deliverables }),
      ...(creatorId && { creator_id: creatorId }),
    });

    router.push(`/book?${params.toString()}`);
  }

  // Tomorrow as min date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];

  return (
    <div className="min-h-screen bg-[#050505] px-4 py-20">
      <div className="mx-auto max-w-lg">
        {/* Header */}
        <h1 className="mb-2 text-2xl font-bold text-white">
          {creatorName ? `Book ${creatorName}` : 'Book a Session'}
        </h1>
        {creatorName && creatorSpecializations.length > 0 && (
          <p className="mb-2 text-sm text-neutral-400">
            {creatorSpecializations.join(', ')}
          </p>
        )}
        {rate > 0 && (
          <p className="mb-8 text-[#D4A843] font-mono text-sm">
            R{rate.toLocaleString()}/hour
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Category */}
          <div>
            <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
              <Camera className="w-3.5 h-3.5" />
              Type of shoot
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
              className="w-full bg-neutral-900 border border-neutral-800 text-white text-sm font-mono px-4 py-3 focus:outline-none focus:border-[#D4A843]/50"
            >
              <option value="">Select...</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Hours */}
          <div>
            <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
              <Clock className="w-3.5 h-3.5" />
              How many hours?
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={minHours}
                max={maxHours}
                value={hours}
                onChange={(e) => setHours(parseInt(e.target.value, 10) || minHours)}
                required
                className="w-24 bg-neutral-900 border border-neutral-800 text-white text-sm font-mono px-4 py-3 text-center focus:outline-none focus:border-[#D4A843]/50"
              />
              <span className="text-neutral-500 text-sm font-mono">
                hours (min {minHours})
              </span>
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
              <Calendar className="w-3.5 h-3.5" />
              When?
            </label>
            <input
              type="date"
              value={date}
              min={minDate}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full bg-neutral-900 border border-neutral-800 text-white text-sm font-mono px-4 py-3 focus:outline-none focus:border-[#D4A843]/50"
            />
          </div>

          {/* Location */}
          <div>
            <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
              <MapPin className="w-3.5 h-3.5" />
              Where? <span className="text-neutral-600">(optional)</span>
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Studio, venue, or city..."
              className="w-full bg-neutral-900 border border-neutral-800 text-white text-sm font-mono px-4 py-3 placeholder-neutral-600 focus:outline-none focus:border-[#D4A843]/50"
            />
          </div>

          {/* What they get.
              The API stopped hard-requiring this because neither route ever
              supplied it, but it is genuinely useful for the creator, so it is
              asked here rather than guessed later. Optional on purpose: it must
              never be the reason a booking does not happen. */}
          <div>
            <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
              <Package className="w-3.5 h-3.5" />
              What do you need back? <span className="text-neutral-600">(optional)</span>
            </label>
            <select
              value={deliverables}
              onChange={(e) => setDeliverables(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 text-white text-sm font-mono px-4 py-3 focus:outline-none focus:border-[#D4A843]/50"
            >
              <option value="">We can decide later...</option>
              {DELIVERABLES.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* Live quote */}
          {quote && (
            <div className="border border-neutral-800 bg-neutral-900/50 p-5 mt-6">
              <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
                Quote
              </p>
              <div className="space-y-2 text-sm font-mono">
                <div className="flex justify-between text-neutral-400">
                  <span>R{rate.toLocaleString()}/hr x {hours}hrs</span>
                  <span>R{quote.subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-neutral-400">
                  <span>VAT ({vatRate}%)</span>
                  <span>R{quote.vat.toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-t border-neutral-700 pt-2 text-lg font-bold text-white">
                  <span>Total</span>
                  <span>R{quote.total.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-4 text-lg font-bold bg-[#D4A843] text-black transition-colors hover:bg-[#c49a3a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {quote ? `Continue — R${quote.total.toLocaleString()}` : 'Continue to Quote'}
          </button>
        </form>
      </div>
    </div>
  );
}
