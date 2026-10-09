'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Plus,
  Package,
  Pencil,
  Trash2,
  ShieldCheck,
  Loader2,
  X,
  ImagePlus,
  Sparkles,
  Send,
  EyeOff,
  Check,
} from 'lucide-react';
import { DashboardSubTabs, STUDIO_TABS } from '@/components/dashboard/DashboardSubTabs';
import { uploadFile, type CloudinaryAsset } from '@/lib/cloudinary/upload';
import { LISTING_POLICY, LISTING_TO_RENTAL_CATEGORY, RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import {
  attestationsComplete,
  unconfirmedAiFields,
  type AiSuggestibleField,
  type ListingStatus,
} from '@/lib/core/listings/review';
import { depositForListing } from '@/lib/core/listings/input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import BankingDetails from '@/components/dashboard/BankingDetails';

type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

type Listing = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  category: string;
  sub_category: string | null;
  brand: string | null;
  model: string | null;
  price_per_day: number | null;
  price_per_week: number | null;
  deposit_amount: number | null;
  replacement_value: number | null;
  serial_number: string | null;
  replacement_value_evidence: string | null;
  rental_includes: string[] | null;
  thumbnail_url: string | null;
  gallery: { url: string; public_id: string }[] | null;
  metadata: { location?: string } | null;
  is_published: boolean;
  is_ai_generated?: boolean;
  listing_status: ListingStatus;
  review_notes: string | null;
  ai_fields: unknown;
  owner_attestations: unknown;
  created_at: string;
  deleted_at: string | null;
};

type ListingForm = {
  title: string;
  description: string;
  category: string;
  brand: string;
  model: string;
  price_per_day: string;
  price_per_week: string;
  replacement_value: string;
  rental_includes: string;
  serial_number: string;
  replacement_value_evidence: string;
  condition: string;
  location: string;
};

type Attest = { owns_or_authorised: boolean; condition_working: boolean; location_accurate: boolean };

const EMPTY_FORM: ListingForm = {
  title: '',
  description: '',
  category: '',
  brand: '',
  model: '',
  price_per_day: '',
  price_per_week: '',
  replacement_value: '',
  rental_includes: '',
  serial_number: '',
  replacement_value_evidence: '',
  condition: '',
  location: '',
};

const NO_ATTEST: Attest = { owns_or_authorised: false, condition_working: false, location_accurate: false };

const CONDITIONS = ['new', 'like-new', 'good', 'fair'];

const STATUS_BADGE: Record<ListingStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' }> = {
  draft: { label: 'Draft', variant: 'default' },
  pending_review: { label: 'Pending review', variant: 'info' },
  published: { label: 'Live', variant: 'success' },
  rejected: { label: 'Not approved', variant: 'error' },
  suspended: { label: 'Taken down', variant: 'error' },
};

const FIELD_LABELS: Record<AiSuggestibleField, string> = {
  title: 'Title',
  description: 'Description',
  category: 'Category',
  brand: 'Brand',
  model: 'Model',
  condition: 'Condition',
  price_per_day: 'Day rate',
  price_per_week: 'Week rate',
  replacement_value: 'Replacement value',
  rental_includes: "What's included",
};

const INPUT_CLASS =
  'w-full min-h-[44px] bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30 placeholder:text-neutral-500';
const LABEL_CLASS = 'flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2';

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return `${STUDIO.currency.symbol}${Number(n).toLocaleString('en-ZA')}`;
}

/** The form's category select holds a real category slug. */
function formCategory(stored: string | null): string {
  if (!stored) return '';
  if (RENTAL_CATEGORIES.some((c) => c.value === stored)) return stored;
  return LISTING_TO_RENTAL_CATEGORY[stored] ?? '';
}

function aiValue(listing: Listing, field: AiSuggestibleField): string {
  switch (field) {
    case 'price_per_day':
    case 'price_per_week':
    case 'replacement_value':
      return money(listing[field]);
    case 'rental_includes':
      return (listing.rental_includes ?? []).join(', ') || '-';
    case 'condition':
      return listing.sub_category ?? '-';
    case 'category':
      return RENTAL_CATEGORIES.find((c) => c.value === listing.category)?.label ?? listing.category;
    default: {
      const v = listing[field];
      return typeof v === 'string' && v ? v : '-';
    }
  }
}

function AiMark() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-[#D4A843] border border-[#D4A843]/30 px-1.5 py-0.5">
      <Sparkles className="w-2.5 h-2.5" />
      AI suggested
    </span>
  );
}

export default function ListingsPage() {
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
  const [hasBanking, setHasBanking] = useState<boolean | null>(null);
  const [payoutVerified, setPayoutVerified] = useState(false);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ListingForm>(EMPTY_FORM);
  const [attest, setAttest] = useState<Attest>(NO_ATTEST);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [images, setImages] = useState<CloudinaryAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    setLoading(true);
    try {
      const res = await fetch('/api/verifications');
      if (res.ok) {
        const data = await res.json();
        setVerificationStatus(data.verification_status ?? 'unverified');
      } else {
        setVerificationStatus('unverified');
      }
    } catch {
      setVerificationStatus('unverified');
    }

    try {
      const bankRes = await fetch('/api/banking');
      if (bankRes.ok) {
        const bankData = await bankRes.json();
        setHasBanking(!!bankData);
        setPayoutVerified(bankData?.is_verified === true);
      } else {
        setHasBanking(false);
      }
    } catch {
      setHasBanking(false);
    }

    try {
      const res = await fetch('/api/listings');
      if (res.ok) {
        const data = await res.json();
        setListings((data as Listing[]) ?? []);
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? 'Failed to fetch listings.');
      }
    } catch {
      setError('Failed to fetch listings.');
    }

    setLoading(false);
  }

  const editing = editingId ? listings.find((l) => l.id === editingId) ?? null : null;
  const pendingAi = editing ? unconfirmedAiFields(editing.ai_fields) : [];
  const isAi = (field: AiSuggestibleField): boolean => pendingAi.includes(field);

  function clearMessages() {
    setError(null);
    setReasons([]);
    setNotice(null);
  }

  // ── Form helpers ────────────────────────────────────────────────────────────

  const openCreate = () => {
    clearMessages();
    setEditingId(null);
    setForm(EMPTY_FORM);
    setAttest(NO_ATTEST);
    setImages([]);
    setShowForm(true);
  };

  const openEdit = (listing: Listing) => {
    clearMessages();
    setEditingId(listing.id);
    setForm({
      title: listing.title,
      description: listing.description ?? '',
      category: formCategory(listing.category),
      brand: listing.brand ?? '',
      model: listing.model ?? '',
      price_per_day: listing.price_per_day?.toString() ?? '',
      price_per_week: listing.price_per_week?.toString() ?? '',
      replacement_value: listing.replacement_value?.toString() ?? '',
      rental_includes: (listing.rental_includes ?? []).join(', '),
      serial_number: listing.serial_number ?? '',
      replacement_value_evidence: listing.replacement_value_evidence ?? '',
      condition: listing.sub_category ?? '',
      location: listing.metadata?.location ?? '',
    });
    const done = attestationsComplete(listing.owner_attestations);
    setAttest(done ? { owns_or_authorised: true, condition_working: true, location_accurate: true } : NO_ATTEST);
    setImages(listing.gallery ?? (listing.thumbnail_url ? [{ url: listing.thumbnail_url, public_id: '' }] : []));
    setShowForm(true);
  };

  const cancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setAttest(NO_ATTEST);
    setImages([]);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remaining = STUDIO.platform.maxListingImages - images.length;
    if (remaining <= 0) {
      setError(`Maximum ${STUDIO.platform.maxListingImages} images per listing.`);
      return;
    }

    const toUpload = Array.from(files).slice(0, remaining);
    setUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      let done = 0;
      const uploaded: CloudinaryAsset[] = [];
      for (const file of toUpload) {
        const asset = await uploadFile(
          file,
          'thabangvision_usecase/media/listings',
          (pct) => setUploadProgress(Math.round((done / toUpload.length) * 100 + pct / toUpload.length)),
        );
        uploaded.push(asset);
        done++;
      }
      setImages((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      e.target.value = '';
    }
  };

  const removeImage = async (index: number) => {
    const img = images[index];
    setImages((prev) => prev.filter((_, i) => i !== index));
    if (img.public_id) {
      fetch('/api/cloudinary/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_id: img.public_id }),
      }).catch(() => {});
    }
  };

  function replaceListing(updated: Listing) {
    setListings((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  const save = async () => {
    clearMessages();
    if (!form.title.trim()) return setError('Title is required.');
    if (!form.category) return setError('Category is required.');
    if (images.length === 0) return setError('At least one image is required.');

    setSaving(true);

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      category: form.category,
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      price_per_day: form.price_per_day || null,
      price_per_week: form.price_per_week || null,
      replacement_value: form.replacement_value || null,
      rental_includes: form.rental_includes
        .split(/[,\n]/)
        .map((v) => v.trim())
        .filter(Boolean),
      serial_number: form.serial_number.trim() || null,
      replacement_value_evidence: form.replacement_value_evidence.trim() || null,
      condition: form.condition || null,
      location: form.location.trim() || null,
      thumbnail_url: images[0]?.url ?? null,
      cover_public_id: images[0]?.public_id || null,
      gallery: images.length > 0 ? images.map((i) => ({ url: i.url, public_id: i.public_id })) : null,
      attestations: attest,
    };

    try {
      const res = await fetch('/api/listings', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId ? { ...payload, id: editingId } : payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? 'Failed to save listing.');
      } else if (editingId) {
        replaceListing(body as Listing);
        if (body?.notice) setNotice(body.notice as string);
        cancel();
      } else {
        setListings((prev) => [body as Listing, ...prev]);
        setNotice('Saved as a draft. Submit it when you are ready to go live.');
        cancel();
      }
    } catch {
      setError('An unexpected error occurred.');
    }

    setSaving(false);
  };

  const confirmAi = async (listing: Listing, fields: AiSuggestibleField[]) => {
    clearMessages();
    setBusyId(listing.id);
    try {
      const res = await fetch('/api/listings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: listing.id, action: 'confirm_ai_fields', fields }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.error ?? 'Could not confirm.');
      else replaceListing(body as Listing);
    } catch {
      setError('Could not confirm.');
    }
    setBusyId(null);
  };

  const submit = async (listing: Listing) => {
    clearMessages();
    setBusyId(listing.id);
    try {
      const res = await fetch(`/api/listings/${listing.id}/submit`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(res.status === 422 ? 'This listing is not ready to submit:' : body?.error ?? 'Failed to submit listing.');
        const list = Array.isArray(body?.reasons) ? (body.reasons as { message: string }[]).map((r) => r.message) : [];
        setReasons(list);
      } else {
        replaceListing(body.listing as Listing);
        setNotice(body.message as string);
      }
    } catch {
      setError('Failed to submit listing.');
    }
    setBusyId(null);
  };

  const unpublish = async (listing: Listing) => {
    clearMessages();
    setBusyId(listing.id);
    try {
      const res = await fetch('/api/listings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: listing.id, action: 'unpublish' }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.error ?? 'Failed to take the listing down.');
      else replaceListing(body as Listing);
    } catch {
      setError('Failed to take the listing down.');
    }
    setBusyId(null);
  };

  const softDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this listing?')) return;
    clearMessages();
    try {
      const res = await fetch('/api/listings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? 'Failed to delete listing.');
      } else {
        setListings((prev) => prev.filter((l) => l.id !== id));
      }
    } catch {
      setError('Failed to delete listing.');
    }
  };

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-2 text-neutral-400 font-mono text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading...
      </div>
    );
  }

  // ── Not verified and nothing saved yet ──────────────────────────────────────

  if (verificationStatus !== 'verified' && listings.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h2 className="text-lg font-display font-medium uppercase text-white mb-6">List Your Gear</h2>
        <EmptyState
          title="Verify Your Identity to List Gear"
          description="To list your equipment for rent, you must first complete identity verification."
          action={{ label: 'Go to Verification', href: '/dashboard/verification' }}
          icon={<ShieldCheck className="w-10 h-10" />}
        />
      </motion.div>
    );
  }

  // ── Verified, no bank account yet ───────────────────────────────────────────

  if (verificationStatus === 'verified' && hasBanking === false && listings.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h2 className="text-lg font-display font-medium uppercase text-white mb-6">List Your Gear</h2>
        <p className="text-sm font-mono text-neutral-400 mb-4">
          Add your banking details to receive payouts before listing gear.
        </p>
        <div className="max-w-lg">
          <BankingDetails onSaved={() => setHasBanking(true)} />
        </div>
      </motion.div>
    );
  }

  const deposit = depositForListing(Number(form.replacement_value) > 0 ? Number(form.replacement_value) : null);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <DashboardSubTabs tabs={STUDIO_TABS} />
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-display font-medium uppercase text-white">Listings</h2>
        <Button size="sm" onClick={openCreate} className="min-h-[44px]">
          <Plus className="w-3 h-3" />
          List New Gear
        </Button>
      </div>

      {/* What going live needs, stated plainly */}
      {(verificationStatus !== 'verified' || !payoutVerified) && (
        <div className="mb-6 px-4 py-3 border border-amber-500/30 bg-amber-500/5 text-amber-300 text-xs font-mono space-y-1">
          <p>You can save drafts now. Before a listing can go live:</p>
          {verificationStatus !== 'verified' && (
            <p>
              - finish your <Link href="/dashboard/verification" className="underline">ID check</Link>
            </p>
          )}
          {!payoutVerified && (
            <p>
              - add a bank account for payouts{hasBanking ? ' (yours is still being validated)' : ''}
            </p>
          )}
        </div>
      )}

      {notice && (
        <div className="mb-6 px-4 py-3 border border-emerald-500/30 bg-emerald-500/5 text-emerald-300 text-xs font-mono">
          {notice}
        </div>
      )}

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-950 border border-red-700/40 text-red-400 text-xs font-mono">
          <p>{error}</p>
          {reasons.length > 0 && (
            <ul className="mt-2 space-y-1">
              {reasons.map((r) => (
                <li key={r}>- {r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Inline Form ──────────────────────────────────────────────────── */}
      {showForm && (
        <Card className="p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xs font-mono uppercase tracking-widest text-white">
              {editingId ? 'Edit Listing' : 'New Listing'}
            </h3>
            <button
              onClick={cancel}
              aria-label="Close form"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* AI suggestions still to check */}
          {editing && pendingAi.length > 0 && (
            <div className="mb-6 border border-[#D4A843]/30 p-4">
              <p className="text-xs font-mono text-[#D4A843] mb-1 uppercase tracking-widest">AI suggestions to check</p>
              <p className="text-xs font-mono text-neutral-400 mb-3">
                These were guessed by AI from your photos and may be wrong. Correct them below, or confirm each one
                you have checked. A listing cannot be submitted until every suggestion is checked.
              </p>
              <ul className="space-y-2">
                {pendingAi.map((field) => (
                  <li key={field} className="flex items-center justify-between gap-3 text-xs font-mono">
                    <span className="text-neutral-300 min-w-0">
                      <span className="text-neutral-500 uppercase tracking-widest">{FIELD_LABELS[field]}: </span>
                      <span className="break-words">{aiValue(editing, field)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => confirmAi(editing, [field])}
                      disabled={busyId === editing.id}
                      className="flex-shrink-0 min-h-[44px] px-3 inline-flex items-center gap-1 border border-[#D4A843]/40 text-[#D4A843] hover:bg-[#D4A843]/10 transition-colors disabled:opacity-50"
                    >
                      <Check className="w-3 h-3" />
                      Correct
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className={LABEL_CLASS}>Title {isAi('title') && <AiMark />}</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Sony A7 III Body"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className={LABEL_CLASS}>Category {isAi('category') && <AiMark />}</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className={INPUT_CLASS}
              >
                <option value="">-- Select --</option>
                {RENTAL_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL_CLASS}>Brand {isAi('brand') && <AiMark />}</label>
              <input
                type="text"
                value={form.brand}
                onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                placeholder="e.g. Sony"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className={LABEL_CLASS}>Model {isAi('model') && <AiMark />}</label>
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                placeholder="e.g. A7 III"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className={LABEL_CLASS}>
                Day rate ({STUDIO.currency.code}) {isAi('price_per_day') && <AiMark />}
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.price_per_day}
                onChange={(e) => setForm((f) => ({ ...f, price_per_day: e.target.value }))}
                placeholder="e.g. 500"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className={LABEL_CLASS}>
                Week rate ({STUDIO.currency.code}, optional) {isAi('price_per_week') && <AiMark />}
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.price_per_week}
                onChange={(e) => setForm((f) => ({ ...f, price_per_week: e.target.value }))}
                placeholder="Charged per full week of a hire"
                className={INPUT_CLASS}
              />
              <p className="mt-1 text-xs font-mono text-neutral-500">
                Charged for each full 7 days. Cannot be more than 7 days at the day rate. Leave blank to charge the day rate.
              </p>
            </div>

            <div>
              <label className={LABEL_CLASS}>
                What&rsquo;s included (optional) {isAi('rental_includes') && <AiMark />}
              </label>
              <input
                type="text"
                value={form.rental_includes}
                onChange={(e) => setForm((f) => ({ ...f, rental_includes: e.target.value }))}
                placeholder="e.g. 2 batteries, charger, strap"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className={LABEL_CLASS}>
                Replacement value ({STUDIO.currency.code}) {isAi('replacement_value') && <AiMark />}
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.replacement_value}
                onChange={(e) => setForm((f) => ({ ...f, replacement_value: e.target.value }))}
                placeholder="What it would cost to replace today"
                className={INPUT_CLASS}
              />
              <p className="mt-1 text-xs font-mono text-neutral-500">
                {deposit !== null
                  ? `Renter deposit: ${money(deposit)} (worked out from this value; you do not set it).`
                  : 'The renter deposit is worked out from this value.'}
              </p>
            </div>

            <div>
              <label className={LABEL_CLASS}>Condition {isAi('condition') && <AiMark />}</label>
              <select
                value={form.condition}
                onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))}
                className={INPUT_CLASS}
              >
                <option value="">-- Select --</option>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1).replace('-', ' ')}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL_CLASS}>Serial number (not shown on the listing)</label>
              <input
                type="text"
                value={form.serial_number}
                onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value }))}
                placeholder="Kept for theft reports"
                className={INPUT_CLASS}
              />
            </div>

            <div className="md:col-span-2">
              <label className={LABEL_CLASS}>Location (suburb and city)</label>
              <input
                type="text"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                placeholder="e.g. Braamfontein, Johannesburg"
                className={INPUT_CLASS}
              />
              <p className="mt-1 text-xs font-mono text-neutral-500">
                Only what you type here is shown. We do not use the location stored in your photos.
              </p>
            </div>

            <div className="md:col-span-2">
              <label className={LABEL_CLASS}>Replacement value evidence (optional)</label>
              <input
                type="text"
                value={form.replacement_value_evidence}
                onChange={(e) => setForm((f) => ({ ...f, replacement_value_evidence: e.target.value }))}
                placeholder="Link to a current price, or a short note"
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="mb-6">
            <label className={LABEL_CLASS}>Description {isAi('description') && <AiMark />}</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder="Describe your equipment, what's included, any notes..."
              className={`${INPUT_CLASS} resize-none`}
            />
          </div>

          {/* Images */}
          <div className="mb-6">
            <label className={LABEL_CLASS}>
              Images ({images.length}/{STUDIO.platform.maxListingImages})
            </label>
            <div className="flex flex-wrap gap-3">
              {images.map((img, i) => (
                <div
                  key={img.public_id || i}
                  className="relative w-20 h-20 bg-neutral-900 border border-white/10 overflow-hidden group"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label="Remove image"
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  {i === 0 && (
                    <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-xs text-white text-center font-mono uppercase py-0.5">
                      Cover
                    </span>
                  )}
                </div>
              ))}
              {images.length < STUDIO.platform.maxListingImages && (
                <label className="w-20 h-20 border border-dashed border-white/20 flex flex-col items-center justify-center cursor-pointer hover:border-white/40 transition-colors">
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 text-neutral-400 animate-spin" />
                      <span className="text-xs font-mono text-neutral-400 mt-1">{uploadProgress}%</span>
                    </>
                  ) : (
                    <>
                      <ImagePlus className="w-4 h-4 text-neutral-400" />
                      <span className="text-xs font-mono text-neutral-400 mt-1">Add</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageUpload}
                    disabled={uploading}
                  />
                </label>
              )}
            </div>
          </div>

          {/* Owner declarations */}
          <fieldset className="mb-6 border border-white/10 p-4">
            <legend className="px-1 text-xs font-mono uppercase tracking-widest text-neutral-400">
              Your declarations
            </legend>
            <p className="text-xs font-mono text-neutral-500 mb-3">
              Needed to submit. These are your statements; we do not inspect the gear before it goes live.
            </p>
            {(
              [
                ['owns_or_authorised', 'I own this gear, or I have the legal right to rent it out.'],
                ['condition_working', 'It is in the condition described and works.'],
                ['location_accurate', 'The location above is where the gear is kept.'],
              ] as const
            ).map(([key, text]) => (
              <label key={key} className="flex items-start gap-3 min-h-[44px] py-2 cursor-pointer text-xs font-mono text-neutral-300">
                <input
                  type="checkbox"
                  checked={attest[key]}
                  onChange={(e) => setAttest((a) => ({ ...a, [key]: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-[#D4A843]"
                />
                <span>{text}</span>
              </label>
            ))}
            <p className="text-xs font-mono text-neutral-500 mt-2">
              Under our{' '}
              <Link href={LISTING_POLICY.ownerTermsHref} className="underline hover:text-white">
                Terms
              </Link>{' '}
              (Part D, Creators and Suppliers).
            </p>
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <Button onClick={save} loading={saving} disabled={uploading || images.length === 0} className="min-h-[44px]">
              {editingId ? 'Save Changes' : 'Save Draft'}
            </Button>
            <Button variant="outline" onClick={cancel} className="min-h-[44px]">
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* ── Listings ─────────────────────────────────────────────────────── */}
      {listings.length === 0 && !showForm ? (
        <EmptyState
          title="No Listings Yet"
          description="List your first piece of gear to start earning rental income."
          action={{ label: 'List New Gear', onClick: openCreate }}
          icon={<Package className="w-8 h-8" />}
        />
      ) : (
        <div className="space-y-3">
          {listings.map((listing) => {
            const status = STATUS_BADGE[listing.listing_status] ?? STATUS_BADGE.draft;
            const unconfirmed = unconfirmedAiFields(listing.ai_fields);
            const canSubmitNow = listing.listing_status === 'draft' || listing.listing_status === 'rejected';
            const canTakeDown = listing.listing_status === 'published' || listing.listing_status === 'pending_review';
            const busy = busyId === listing.id;
            return (
              <Card key={listing.id} hover className="p-0 overflow-hidden">
                <div className="flex items-stretch">
                  {listing.gallery && listing.gallery.length > 0 ? (
                    <div className="w-20 h-20 flex-shrink-0 bg-neutral-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={listing.gallery[0].url} alt={listing.title} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-20 h-20 flex-shrink-0 bg-neutral-900 flex items-center justify-center">
                      <Package className="w-6 h-6 text-neutral-400" />
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 flex-1 min-w-0 p-5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="text-sm font-medium text-white truncate">{listing.title}</h3>
                        <Badge variant={status.variant}>{status.label}</Badge>
                        {listing.is_ai_generated && (
                          <span className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-widest text-[#D4A843] border border-[#D4A843]/30 px-1.5 py-0.5">
                            <Sparkles className="w-2.5 h-2.5" />
                            AI drafted
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                        {listing.category}
                        {listing.sub_category ? ` / ${listing.sub_category}` : ''}
                        {listing.metadata?.location ? ` / ${listing.metadata.location}` : ''}
                      </p>
                      {(listing.listing_status === 'rejected' || listing.listing_status === 'suspended') &&
                        listing.review_notes && (
                          <p className="mt-2 text-xs font-mono text-red-400">Reviewer: {listing.review_notes}</p>
                        )}
                      {listing.listing_status === 'pending_review' && (
                        <p className="mt-2 text-xs font-mono text-neutral-500">
                          Waiting for a person to review it. Editing it takes it back to draft.
                        </p>
                      )}
                      {unconfirmed.length > 0 && (
                        <p className="mt-2 text-xs font-mono text-[#D4A843]">
                          AI-suggested, not yet checked: {unconfirmed.map((f) => FIELD_LABELS[f]).join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      {listing.price_per_day !== null && (
                        <p className="text-sm font-mono font-bold text-white whitespace-nowrap">
                          {money(listing.price_per_day)}/day
                        </p>
                      )}
                      <div className="flex items-center gap-1">
                        {canSubmitNow && (
                          <button
                            onClick={() => submit(listing)}
                            disabled={busy}
                            title="Submit to go live"
                            className="min-h-[44px] px-3 inline-flex items-center gap-1 text-xs font-mono uppercase tracking-widest border border-[#D4A843]/30 text-[#D4A843] hover:bg-[#D4A843]/5 hover:border-[#D4A843]/60 transition-colors disabled:opacity-50"
                          >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                            Submit
                          </button>
                        )}
                        {canTakeDown && (
                          <button
                            onClick={() => unpublish(listing)}
                            disabled={busy}
                            title={listing.listing_status === 'published' ? 'Take down' : 'Withdraw from review'}
                            aria-label={listing.listing_status === 'published' ? 'Take down' : 'Withdraw from review'}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-white/10 text-neutral-400 hover:border-white/30 hover:text-white transition-colors disabled:opacity-50"
                          >
                            <EyeOff className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {listing.listing_status !== 'suspended' && (
                          <button
                            onClick={() => openEdit(listing)}
                            title="Edit"
                            aria-label="Edit"
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-white/10 text-neutral-400 hover:border-white/30 hover:text-white transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => softDelete(listing.id)}
                          title="Delete"
                          aria-label="Delete"
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-red-900/40 text-red-600 hover:border-red-500/40 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
