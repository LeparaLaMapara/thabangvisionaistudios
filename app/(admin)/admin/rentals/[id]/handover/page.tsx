'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Camera, Loader2 } from 'lucide-react';
import { uploadFile } from '@/lib/cloudinary/upload';

/**
 * Staff handover at the counter (TASK-067), like an Apple Store pickup:
 * check the person against their ID, photograph the gear and the renter with
 * it, read the agreement together, and have them sign on the screen.
 */

interface HandoverData {
  booking: { id: string; status: string; start_date: string; end_date: string; quantity: number | null; handover: unknown };
  rental: { title: string; serial_number: string | null; tracker_fitted: boolean | null } | null;
  renter: { name: string; verification: string; selfieUrl: string | null };
  agreement: { version: string; lines: string[] };
}

const CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'like_new', label: 'Like new' },
  { value: 'good', label: 'Good (light wear)' },
  { value: 'fair', label: 'Fair (visible wear, works fully)' },
];

export default function HandoverPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<HandoverData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idChecked, setIdChecked] = useState(false);
  const [condition, setCondition] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [renterPhoto, setRenterPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [signed, setSigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/rentals/${id}/handover`)
      .then(async (res) => ({ ok: res.ok, json: await res.json() }))
      .then(({ ok, json }) => {
        if (!alive) return;
        if (ok) setData(json);
        else setError(json.error ?? 'Could not load the booking.');
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const upload = async (files: FileList | null, into: 'condition' | 'renter') => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const asset = await uploadFile(file, `thabangvision/handovers/${id}`);
        if (into === 'renter') setRenterPhoto(asset.url);
        else setPhotos((p) => [...p, asset.url]);
      }
    } catch {
      setError('A photo did not upload. Try again.');
    } finally {
      setUploading(false);
    }
  };

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawing.current = true;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const { x, y } = point(e);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#050505';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setSigned(true);
  };
  const end = () => {
    drawing.current = false;
  };
  const clearSignature = useCallback(() => {
    const c = canvasRef.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setSigned(false);
  }, []);

  const submit = async () => {
    if (!data) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/rentals/${id}/handover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idChecked,
        condition,
        conditionPhotos: photos,
        renterPhoto,
        signature: canvasRef.current?.toDataURL('image/png'),
        agreementVersion: data.agreement.version,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(json.error ?? 'Could not save the handover.');
      return;
    }
    router.push('/admin/bookings');
  };

  const ready = idChecked && condition && photos.length > 0 && signed && !uploading && !saving;

  return (
    <div className="max-w-2xl mx-auto p-6 md:p-10 space-y-8">
      <Link href="/admin/bookings" className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-400">
        <ArrowLeft className="w-3 h-3" /> Bookings
      </Link>
      <header>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-1">Handover</p>
        <h1 className="text-2xl font-display text-white tracking-tight">
          {data?.rental?.title ?? 'Loading…'}
          {(data?.booking.quantity ?? 1) > 1 ? ` x${data?.booking.quantity}` : ''}
        </h1>
        {data && (
          <p className="text-xs font-mono text-neutral-400 mt-2">
            {data.booking.start_date} to {data.booking.end_date}
            {data.rental?.serial_number ? ` · serial ${data.rental.serial_number}` : ' · no serial recorded'}
            {data.rental?.tracker_fitted ? ' · tracker fitted' : ''}
          </p>
        )}
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {data && data.booking.status !== 'confirmed' && (
        <p className="text-sm text-[#D4A843]">This booking is {data.booking.status}. Only a confirmed (paid) booking can be handed over.</p>
      )}

      {data && (
        <>
          <section className="space-y-3">
            <h2 className="text-xs font-mono uppercase tracking-widest text-white">1. Check the person</h2>
            <p className="text-sm text-neutral-300">
              Account name: <span className="text-white">{data.renter.name}</span> · ID check: {data.renter.verification}
            </p>
            {data.renter.selfieUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.renter.selfieUrl} alt="The selfie they sent with their ID" className="w-48 rounded border border-white/10" />
            ) : (
              <p className="text-xs text-neutral-400">
                Their ID photos are no longer kept (deleted 30 days after the check). Ask for the ID card and check the name matches.
              </p>
            )}
            <label className="flex items-center gap-3 min-h-[44px] text-sm text-white">
              <input type="checkbox" checked={idChecked} onChange={(e) => setIdChecked(e.target.checked)} className="w-5 h-5" />
              I checked their ID card: the face and the name match.
            </label>
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-mono uppercase tracking-widest text-white">2. Photograph the gear</h2>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="w-full min-h-[44px] bg-[#050505] border border-white/10 rounded px-3 text-sm text-white"
            >
              <option value="">Condition it leaves in…</option>
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <PhotoButton label="Add condition photos" multiple disabled={uploading} onFiles={(f) => upload(f, 'condition')} />
            {photos.length > 0 && <p className="text-xs text-neutral-400">{photos.length} photo(s) added</p>}
            <PhotoButton label={renterPhoto ? 'Retake renter photo' : 'Photo of the renter with the gear'} disabled={uploading} onFiles={(f) => upload(f, 'renter')} />
            {uploading && <p className="text-xs text-neutral-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</p>}
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-mono uppercase tracking-widest text-white">3. Read and sign</h2>
            <ol className="list-decimal pl-5 space-y-2 text-sm text-neutral-300 leading-relaxed">
              {data.agreement.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            <canvas
              ref={canvasRef}
              width={600}
              height={200}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerLeave={end}
              className="w-full h-40 bg-white rounded touch-none"
              aria-label="Signature pad"
            />
            <button onClick={clearSignature} className="min-h-[44px] text-xs font-mono uppercase tracking-widest text-neutral-400">
              Clear signature
            </button>
          </section>

          <button
            onClick={submit}
            disabled={!ready || data.booking.status !== 'confirmed'}
            className="w-full min-h-[48px] rounded bg-[#D4A843] text-[#050505] text-xs font-mono font-bold uppercase tracking-widest disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Hand over and start the hire'}
          </button>
        </>
      )}
    </div>
  );
}

function PhotoButton({ label, onFiles, multiple, disabled }: { label: string; onFiles: (f: FileList | null) => void; multiple?: boolean; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-center gap-2 min-h-[44px] rounded border border-white/20 text-xs font-mono uppercase tracking-widest text-white cursor-pointer ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <Camera className="w-4 h-4" aria-hidden="true" />
      {label}
      <input type="file" accept="image/*" capture="environment" multiple={multiple} className="sr-only" onChange={(e) => onFiles(e.target.files)} />
    </label>
  );
}
