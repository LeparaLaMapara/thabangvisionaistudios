'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { OwnerHires } from './OwnerHires';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Plus,
  Package,
  Pencil,
  Trash2,
  Loader2,
  X,
  ImagePlus,
  Sparkles,
  Send,
  EyeOff,
  Check,
  CircleCheck,
  CircleAlert,
  Clock,
  Info,
} from 'lucide-react';
import { DashboardSubTabs, STUDIO_TABS } from '@/components/dashboard/DashboardSubTabs';
import { uploadFile, type CloudinaryAsset } from '@/lib/cloudinary/upload';
import { createClient } from '@/lib/supabase/client';
import { LISTING_POLICY, LISTING_TO_RENTAL_CATEGORY, RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import {
  attestationsComplete,
  unconfirmedAiFields,
  type AiSuggestibleField,
  type ListingStatus,
} from '@/lib/core/listings/review';
import { depositForListing, includesFromText, includesToText } from '@/lib/core/listings/input';
import { LISTING_CONDITIONS, normaliseCondition, profileLocation } from '@/lib/core/listings/suggest';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Owner listings, photo first (spec §9.3):
 *   1. Photo   upload, then "Suggest details" (AI) or "Fill in myself"
 *   2. Details review the suggested details and price; confirm each AI
 *              suggestion (or all at once); enter the replacement value
 *   3. Submit  see what still blocks it (ID check, payout account, fields),
 *              give the three declarations, submit. A person reviews it
 *              where the rules say so (lib/core/listings/review.ts).
 * Nothing here relaxes a Phase 2 rule: the server re-checks everything.
 */

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
  metadata: { location?: string; detection_confidence?: number | null } | null;
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

type Block = { code: string; message: string };
type Precheck = {
  canSubmit: boolean;
  statusBlock: Block | null;
  ownerBlocks: Block[];
  listingBlocks: Block[];
  review: { required: boolean; reasons: Block[] };
  outcome: 'pending_review' | 'published' | null;
};

type Mode = 'list' | 'photos' | 'details' | 'submit';

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
const ALL_ATTEST: Attest = { owns_or_authorised: true, condition_working: true, location_accurate: true };

const DECLARATIONS: readonly (readonly [keyof Attest, string])[] = [
  ['owns_or_authorised', 'I own this gear, or I have the legal right to rent it out.'],
  ['condition_working', 'It is in the condition described and works.'],
  ['location_accurate', 'The location on the listing is where the gear is kept.'],
];

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

/** Fields inside "More details". */
const MORE_FIELDS: readonly AiSuggestibleField[] = ['price_per_week', 'rental_includes'];

/** The form input each server `field` answer points at. */
const FIELD_INPUT_ID: Record<string, string> = {
  title: 'listing-title',
  category: 'listing-category',
  brand: 'listing-brand',
  model: 'listing-model',
  condition: 'listing-condition',
  price_per_day: 'listing-day-rate',
  price_per_week: 'listing-week-rate',
  replacement_value: 'listing-replacement-value',
  rental_includes: 'listing-includes',
  serial_number: 'listing-serial',
  location: 'listing-location',
  replacement_value_evidence: 'listing-evidence',
  description: 'listing-description',
  gallery: 'listing-photos',
};

// One request id per set of photos, kept for this page visit, so retrying a
// suggestion for the same photos is recognised by the server.
const suggestIds = new Map<string, string>();
function suggestRequestId(images: readonly { url: string; public_id?: string | null }[]): string {
  const key = images.map((i) => i.public_id || i.url).join('|');
  let id = suggestIds.get(key);
  if (!id) {
    id = crypto.randomUUID();
    suggestIds.set(key, id);
  }
  return id;
}

const THRESHOLD_RANDS = LISTING_POLICY.reviewValueThresholdCents / 100;
const ESTABLISHED = LISTING_POLICY.establishedOwner;

const INPUT_CLASS =
  'w-full min-h-[44px] bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30 focus-visible:ring-2 focus-visible:ring-[#D4A843] placeholder:text-neutral-500 aria-[invalid=true]:border-red-500/60';
const LABEL_CLASS = 'flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2';
const HINT_CLASS = 'mt-1 text-xs font-mono text-neutral-500';

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return `${STUDIO.currency.symbol}${Number(n).toLocaleString('en-ZA')}`;
}

/** Why a person will review a listing, in the owner's words. */
function reviewReasonText(code: string, fallback: string): string {
  switch (code) {
    case 'owner_not_verified':
      return 'Your ID check is not complete yet.';
    case 'first_listing':
      return 'It is your first live listing.';
    case 'high_value':
      return `It is worth more than ${money(THRESHOLD_RANDS)}.`;
    case 'unknown_value':
      return 'It has no replacement value yet.';
    case 'open_disputes':
      return 'There is an open dispute on one of your hires.';
    case 'owner_suspended':
      return 'Your account is suspended.';
    case 'previous_rejection':
      return 'One of your listings was not approved before.';
    case 'suspended_listing':
      return 'One of your listings was taken down.';
    case 'resubmission':
      return 'It was not approved before.';
    case 'not_established':
      return `Until you have ${ESTABLISHED.minPublishedListings} live listings and ${ESTABLISHED.minCompletedRentals} completed hires, a person checks each listing.`;
    default:
      return fallback;
  }
}

/** The form's category select holds a real category slug. */
function formCategory(stored: string | null): string {
  if (!stored) return '';
  if (RENTAL_CATEGORIES.some((c) => c.value === stored)) return stored;
  return LISTING_TO_RENTAL_CATEGORY[stored] ?? '';
}

function conditionLabel(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1).replace('-', ' ');
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
      return listing.sub_category ? conditionLabel(listing.sub_category) : '-';
    case 'category':
      return RENTAL_CATEGORIES.find((c) => c.value === listing.category)?.label ?? listing.category;
    default: {
      const v = listing[field];
      return typeof v === 'string' && v ? v : '-';
    }
  }
}

function formFrom(listing: Listing): ListingForm {
  return {
    title: listing.title,
    description: listing.description ?? '',
    category: formCategory(listing.category),
    brand: listing.brand ?? '',
    model: listing.model ?? '',
    price_per_day: listing.price_per_day?.toString() ?? '',
    price_per_week: listing.price_per_week?.toString() ?? '',
    replacement_value: listing.replacement_value?.toString() ?? '',
    // One item per line: an item may itself contain a comma.
    rental_includes: includesToText(listing.rental_includes),
    serial_number: listing.serial_number ?? '',
    replacement_value_evidence: listing.replacement_value_evidence ?? '',
    condition: normaliseCondition(listing.sub_category) ?? listing.sub_category ?? '',
    location: listing.metadata?.location ?? '',
  };
}

function AiMark() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-[#D4A843] border border-[#D4A843]/30 px-1.5 py-0.5 normal-case">
      <Sparkles className="w-2.5 h-2.5" aria-hidden="true" />
      AI suggested
    </span>
  );
}

function Required() {
  return (
    <span className="text-red-400" aria-hidden="true">
      *
    </span>
  );
}

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps = ['Photo', 'Details and price', 'Submit'];
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 mb-6 text-xs font-mono uppercase tracking-widest" aria-label="Listing steps">
      {steps.map((s, i) => (
        <li
          key={s}
          aria-current={i + 1 === step ? 'step' : undefined}
          className={i + 1 === step ? 'text-[#D4A843]' : i + 1 < step ? 'text-neutral-300' : 'text-neutral-500'}
        >
          {i + 1}. {s}
        </li>
      ))}
    </ol>
  );
}

export default function ListingsPage() {
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
  const [verificationError, setVerificationError] = useState(false);
  const [hasBanking, setHasBanking] = useState<boolean | null>(null);
  const [payoutVerified, setPayoutVerified] = useState(false);
  const [bankingError, setBankingError] = useState(false);
  const [homeLocation, setHomeLocation] = useState<string | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<Mode>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitId, setSubmitId] = useState<string | null>(null);
  const [form, setForm] = useState<ListingForm>(EMPTY_FORM);
  const [attest, setAttest] = useState<Attest>(NO_ATTEST);
  const [images, setImages] = useState<CloudinaryAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const [lowConfidenceId, setLowConfidenceId] = useState<string | null>(null);
  const [precheck, setPrecheck] = useState<Precheck | null>(null);
  const [precheckState, setPrecheckState] = useState<'idle' | 'loading' | 'error'>('idle');

  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewReasons, setReviewReasons] = useState<string[]>([]);

  const errorRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Loading: every read at once ─────────────────────────────────────────────

  const init = useCallback(async () => {
    setLoading(true);
    const [verification, banking, owned, profile] = await Promise.allSettled([
      fetch('/api/verifications').then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch('/api/banking').then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch('/api/listings').then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? 'Failed to fetch listings.');
        return body as Listing[];
      }),
      (async () => {
        const supabase = createClient();
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) return null;
        const { data } = await supabase.from('profiles').select('city, province, location').eq('id', auth.user.id).maybeSingle();
        return data as { city?: string | null; province?: string | null; location?: string | null } | null;
      })(),
    ]);

    if (verification.status === 'fulfilled') {
      setVerificationStatus((verification.value?.verification_status as VerificationStatus) ?? 'unverified');
      setVerificationError(false);
    } else {
      // Not the same as "not verified": say we could not check.
      setVerificationStatus(null);
      setVerificationError(true);
    }

    if (banking.status === 'fulfilled') {
      // GET /api/banking answers 200 with null when nothing is saved.
      const bank = banking.value as { is_verified?: boolean } | null;
      setHasBanking(!!bank);
      setPayoutVerified(bank?.is_verified === true);
      setBankingError(false);
    } else {
      setHasBanking(null);
      setBankingError(true);
    }

    if (owned.status === 'fulfilled') setListings(owned.value ?? []);
    else setError(owned.reason instanceof Error ? owned.reason.message : 'Failed to fetch listings.');

    if (profile.status === 'fulfilled') setHomeLocation(profileLocation(profile.value));

    // Links from elsewhere: ?new=1 (welcome "List my gear"), ?drafted=N (onboarding).
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('new') === '1') {
        setMode('photos');
      }
      const drafted = Number(q.get('drafted'));
      if (Number.isFinite(drafted) && drafted > 0) {
        const low = Number(q.get('low')) || 0;
        setNotice(
          `${drafted} draft listing${drafted === 1 ? '' : 's'} saved from your photos. Open each one to check the suggested details and add a replacement value.` +
            (low > 0 ? ` ${low} of them we were not sure about: check every detail.` : ''),
        );
      }
    } catch {
      /* no query string to read */
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  // Errors are announced and brought into view; the field the server named gets focus.
  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (errorField && FIELD_INPUT_ID[errorField]) {
      document.getElementById(FIELD_INPUT_ID[errorField])?.focus({ preventScroll: true });
    }
  }, [error, errorField]);

  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [notice]);

  // Each step opens above the list: bring it into view (on a phone the
  // Submit button that opened it may be far below).
  useEffect(() => {
    if (mode !== 'list') panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [mode, editingId, submitId]);

  const editing = editingId ? listings.find((l) => l.id === editingId) ?? null : null;
  const pendingAi = editing ? unconfirmedAiFields(editing.ai_fields) : [];
  const isAi = (field: AiSuggestibleField): boolean => pendingAi.includes(field);
  const pendingInMore = pendingAi.filter((f) => MORE_FIELDS.includes(f));
  const submitting = submitId ? listings.find((l) => l.id === submitId) ?? null : null;

  function clearMessages() {
    setError(null);
    setErrorField(null);
    setReasons([]);
    setNotice(null);
    setReviewReasons([]);
  }

  function fail(message: string, field?: string | null) {
    setError(message);
    setErrorField(field ?? null);
  }

  function replaceListing(updated: Listing) {
    setListings((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
  }

  // ── Steps ───────────────────────────────────────────────────────────────────

  const startNew = () => {
    clearMessages();
    setEditingId(null);
    setSubmitId(null);
    setForm(EMPTY_FORM);
    setImages([]);
    setLowConfidenceId(null);
    setMode('photos');
  };

  const fillInMyself = () => {
    clearMessages();
    setEditingId(null);
    setForm({ ...EMPTY_FORM, location: homeLocation ?? '' });
    setMode('details');
  };

  const openEdit = (listing: Listing) => {
    clearMessages();
    setEditingId(listing.id);
    setSubmitId(null);
    setForm(formFrom(listing));
    setImages(listing.gallery ?? (listing.thumbnail_url ? [{ url: listing.thumbnail_url, public_id: '' }] : []));
    setMode('details');
  };

  const openSubmit = async (listing: Listing) => {
    clearMessages();
    setSubmitId(listing.id);
    setEditingId(null);
    setAttest(attestationsComplete(listing.owner_attestations) ? ALL_ATTEST : NO_ATTEST);
    setMode('submit');
    await loadPrecheck(listing.id);
  };

  const close = () => {
    setMode('list');
    setEditingId(null);
    setSubmitId(null);
    setForm(EMPTY_FORM);
    setAttest(NO_ATTEST);
    setImages([]);
    setPrecheck(null);
    setPrecheckState('idle');
  };

  async function loadPrecheck(id: string) {
    setPrecheck(null);
    setPrecheckState('loading');
    try {
      const res = await fetch(`/api/listings/${id}/check`);
      if (!res.ok) throw new Error(String(res.status));
      setPrecheck((await res.json()) as Precheck);
      setPrecheckState('idle');
    } catch {
      setPrecheckState('error');
    }
  }

  // ── Photos ──────────────────────────────────────────────────────────────────

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remaining = STUDIO.platform.maxListingImages - images.length;
    if (remaining <= 0) {
      fail(`At most ${STUDIO.platform.maxListingImages} photos per listing.`, 'gallery');
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
      fail(err instanceof Error ? err.message : 'Photo upload failed.', 'gallery');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      e.target.value = '';
    }
  };

  const removeImage = (index: number) => {
    const img = images[index];
    setImages((prev) => prev.filter((_, i) => i !== index));
    // A photo still on a saved listing is only removed from it when the owner saves.
    const onSaved = editing?.gallery?.some((g) => g.url === img.url);
    if (img.public_id && !onSaved) {
      fetch('/api/cloudinary/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_id: img.public_id }),
      }).catch(() => {});
    }
  };

  /** Photo → AI suggestion. The server creates the draft and records every suggested field. */
  const suggestDetails = async () => {
    clearMessages();
    if (images.length === 0) return fail('Add a photo first.', 'gallery');
    setSuggesting(true);
    try {
      const res = await fetch('/api/listings/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallery: images.map((i) => ({ url: i.url, public_id: i.public_id })),
          cover_public_id: images[0]?.public_id || null,
          // Same id on a retry of the same photos: the server returns the draft
          // it already made instead of creating a duplicate.
          request_id: suggestRequestId(images),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.listing) {
        // Nothing was saved: carry on by hand with the same photos.
        setForm({ ...EMPTY_FORM, location: homeLocation ?? '' });
        setEditingId(null);
        setMode('details');
        fail(body?.error ?? 'Could not suggest details. Fill them in yourself.');
        return;
      }
      const listing = body.listing as Listing;
      setListings((prev) => [listing, ...prev]);
      setEditingId(listing.id);
      setForm(formFrom(listing));
      setImages(listing.gallery ?? images);
      setLowConfidenceId(body.low_confidence ? listing.id : null);
      setMode('details');
      setNotice(
        'Saved as a draft with suggested details. Check each suggestion below (or confirm them all), then add the replacement value.',
      );
    } catch {
      setForm({ ...EMPTY_FORM, location: homeLocation ?? '' });
      setMode('details');
      fail('Could not suggest details. Fill them in yourself.');
    } finally {
      setSuggesting(false);
    }
  };

  // ── Save, confirm, submit ───────────────────────────────────────────────────

  const save = async () => {
    clearMessages();
    if (images.length === 0) return fail('Add at least one photo.', 'gallery');
    if (!form.title.trim()) return fail('Add a title.', 'title');
    if (!form.category) return fail('Choose a category.', 'category');

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
      // New lines only, so "Lens caps (front, rear)" stays one item and an
      // unchanged list is sent back as it was stored.
      rental_includes: includesFromText(form.rental_includes),
      serial_number: form.serial_number.trim() || null,
      replacement_value_evidence: form.replacement_value_evidence.trim() || null,
      condition: form.condition || null,
      location: form.location.trim() || null,
      thumbnail_url: images[0]?.url ?? null,
      cover_public_id: images[0]?.public_id || null,
      gallery: images.map((i) => ({ url: i.url, public_id: i.public_id })),
    };

    try {
      const send = () => fetch('/api/listings', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId ? { ...payload, id: editingId } : payload),
      });
      let res = await send();
      let body = await res.json().catch(() => null);
      // A 409 with no code means another change to this listing landed at the
      // same moment (e.g. a confirm still in flight). The server reads the
      // listing afresh on every request, so trying once more is safe.
      if (editingId && res.status === 409 && !body?.code) {
        res = await send();
        body = await res.json().catch(() => null);
      }
      if (!res.ok) {
        fail(
          res.status === 409 && !body?.code
            ? 'This listing was changed at the same time (another tab or action). Your edits are still here: press Save again.'
            : body?.error ?? 'Failed to save listing.',
          body?.field,
        );
      } else {
        const saved = body as Listing;
        if (editingId) replaceListing(saved);
        else setListings((prev) => [saved, ...prev]);
        setSaving(false);
        await openSubmit(saved);
        if (body?.notice) setNotice(body.notice as string);
        return;
      }
    } catch {
      fail('Could not save. Check your connection and try again.');
    }
    setSaving(false);
  };

  const confirmAi = async (listing: Listing, fields: AiSuggestibleField[]) => {
    setError(null);
    setBusyId(listing.id);
    try {
      const res = await fetch('/api/listings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: listing.id, action: 'confirm_ai_fields', fields }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) fail(body?.error ?? 'Could not confirm.');
      else replaceListing(body as Listing);
    } catch {
      fail('Could not confirm.');
    }
    setBusyId(null);
  };

  const submit = async (listing: Listing) => {
    clearMessages();
    if (!(attest.owns_or_authorised && attest.condition_working && attest.location_accurate)) {
      return fail('Tick all three declarations to submit.');
    }
    setBusyId(listing.id);
    try {
      // The declarations are stored first (the submit request carries nothing).
      if (!attestationsComplete(listing.owner_attestations)) {
        const a = await fetch('/api/listings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: listing.id, action: 'attest', attestations: attest }),
        });
        const ab = await a.json().catch(() => null);
        if (!a.ok) {
          fail(ab?.error ?? 'Could not save your declarations.');
          setBusyId(null);
          return;
        }
        replaceListing(ab as Listing);
      }

      const res = await fetch(`/api/listings/${listing.id}/submit`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        fail(res.status === 422 ? 'This listing is not ready to submit:' : body?.error ?? 'Failed to submit listing.');
        const list = Array.isArray(body?.reasons) ? (body.reasons as { message: string }[]).map((r) => r.message) : [];
        setReasons(list);
        await loadPrecheck(listing.id);
      } else {
        if (body.listing) replaceListing(body.listing as Listing);
        const codes: string[] = Array.isArray(body.review_reason_codes) ? body.review_reason_codes : [];
        const messages: string[] = Array.isArray(body.review_reasons) ? body.review_reasons : [];
        setReviewReasons(body.status === 'pending_review' ? codes.map((c, i) => reviewReasonText(c, messages[i] ?? c)) : []);
        setMode('list');
        setSubmitId(null);
        setPrecheck(null);
        setNotice(body.message as string);
      }
    } catch {
      fail('Failed to submit listing.');
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
      if (!res.ok) fail(body?.error ?? 'Failed to take the listing down.');
      else replaceListing(body as Listing);
    } catch {
      fail('Failed to take the listing down.');
    }
    setBusyId(null);
  };

  const softDelete = async (id: string) => {
    if (!confirm('Delete this listing?')) return;
    clearMessages();
    try {
      const res = await fetch('/api/listings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        fail(body?.error ?? 'Failed to delete listing.');
      } else {
        setListings((prev) => prev.filter((l) => l.id !== id));
        if (editingId === id || submitId === id) close();
      }
    } catch {
      fail('Failed to delete listing.');
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-2 text-neutral-400 font-mono text-sm" role="status">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        Loading...
      </div>
    );
  }

  const deposit = depositForListing(Number(form.replacement_value) > 0 ? Number(form.replacement_value) : null);
  const ownerReady = verificationStatus === 'verified' && payoutVerified;

  const photoUploader = (
    <div>
      <p className={LABEL_CLASS} id="listing-photos-label">
        Photos <Required /> ({images.length}/{STUDIO.platform.maxListingImages})
      </p>
      <div className="flex flex-wrap gap-3" aria-labelledby="listing-photos-label">
        {images.map((img, i) => (
          <div key={img.public_id || img.url} className="relative w-24 h-24 bg-neutral-900 border border-white/10 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={i === 0 ? 'Cover photo' : `Photo ${i + 1}`} className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => removeImage(i)}
              aria-label={i === 0 ? 'Remove cover photo' : `Remove photo ${i + 1}`}
              className="absolute top-0 right-0 w-11 h-11 bg-black/75 text-white flex items-center justify-center hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A843]"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
            {i === 0 && (
              <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-xs text-white text-center font-mono uppercase py-0.5">
                Cover
              </span>
            )}
          </div>
        ))}
        {images.length < STUDIO.platform.maxListingImages && (
          <label
            htmlFor="listing-photos"
            className="w-24 h-24 border border-dashed border-white/20 flex flex-col items-center justify-center cursor-pointer hover:border-white/40 transition-colors focus-within:ring-2 focus-within:ring-[#D4A843]"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 text-neutral-400 animate-spin" aria-hidden="true" />
                <span className="text-xs font-mono text-neutral-400 mt-1">{uploadProgress}%</span>
              </>
            ) : (
              <>
                <ImagePlus className="w-5 h-5 text-neutral-400" aria-hidden="true" />
                <span className="text-xs font-mono text-neutral-400 mt-1">{images.length === 0 ? 'Add photo' : 'Add more'}</span>
              </>
            )}
            <input
              id="listing-photos"
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={handleImageUpload}
              disabled={uploading}
              aria-invalid={errorField === 'gallery' || undefined}
            />
          </label>
        )}
      </div>
      <p className={HINT_CLASS}>The first photo is the cover. Location data stored in photos is never shown.</p>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <DashboardSubTabs tabs={STUDIO_TABS} />
      <div className="flex items-center justify-between gap-3 mb-6">
        <h2 className="text-lg font-display font-medium uppercase text-white">Listings</h2>
        {mode === 'list' && (
          <Button size="sm" onClick={startNew} className="min-h-[44px]">
            <Plus className="w-3 h-3" aria-hidden="true" />
            List new gear
          </Button>
        )}
      </div>

      {/* What going live needs, stated plainly. Drafts never wait for any of it. */}
      {!ownerReady && (
        <section aria-labelledby="go-live-heading" className="mb-6 border border-white/10 bg-[#0A0A0B] p-4">
          <h3 id="go-live-heading" className="text-xs font-mono uppercase tracking-widest text-white mb-1">
            Before a listing can go live
          </h3>
          <p className="text-xs font-mono text-neutral-400 mb-3">You can create and save drafts now.</p>
          <ul className="space-y-3 text-xs font-mono">
            <li className="flex gap-3">
              {verificationError ? (
                <CircleAlert className="w-4 h-4 text-red-400 flex-shrink-0" aria-hidden="true" />
              ) : verificationStatus === 'verified' ? (
                <CircleCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden="true" />
              ) : verificationStatus === 'pending' ? (
                <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" aria-hidden="true" />
              ) : (
                <CircleAlert className="w-4 h-4 text-amber-400 flex-shrink-0" aria-hidden="true" />
              )}
              <span className="text-neutral-300">
                <strong className="text-white font-normal">ID check. </strong>
                {verificationError ? (
                  <span className="text-red-400">We could not check your ID status just now. Reload the page to try again.</span>
                ) : verificationStatus === 'verified' ? (
                  'Done.'
                ) : verificationStatus === 'pending' ? (
                  `A person is checking it, ${STUDIO.verification.reviewTime}.`
                ) : (
                  <>
                    {verificationStatus === 'rejected' ? 'Not accepted; please send it again. ' : 'Not done yet. '}
                    <Link href="/dashboard/verification" className="underline hover:text-white">
                      Do the ID check
                    </Link>
                  </>
                )}
              </span>
            </li>
            <li className="flex gap-3">
              {bankingError ? (
                <CircleAlert className="w-4 h-4 text-red-400 flex-shrink-0" aria-hidden="true" />
              ) : payoutVerified ? (
                <CircleCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden="true" />
              ) : (
                <CircleAlert className="w-4 h-4 text-amber-400 flex-shrink-0" aria-hidden="true" />
              )}
              <span className="text-neutral-300">
                <strong className="text-white font-normal">Payout bank account, validated. </strong>
                {bankingError ? (
                  <span className="text-red-400">We could not check your payout account just now. Reload the page to try again.</span>
                ) : payoutVerified ? (
                  'Done.'
                ) : (
                  <>
                    {hasBanking ? 'Saved, not validated yet. ' : 'Not added yet. '}
                    We validate it with your bank only after your ID check passes, and the account holder name must match
                    the name on your ID.{' '}
                    <Link href="/dashboard/banking" className="underline hover:text-white">
                      {hasBanking ? 'Check your payout account' : 'Add a payout account'}
                    </Link>
                  </>
                )}
              </span>
            </li>
            <li className="flex gap-3">
              <Info className="w-4 h-4 text-neutral-400 flex-shrink-0" aria-hidden="true" />
              <span className="text-neutral-300">
                <strong className="text-white font-normal">A person reviews listings at first. </strong>
                Until you have {ESTABLISHED.minPublishedListings} live listings and {ESTABLISHED.minCompletedRentals} completed
                hires, a person checks each listing before it goes live. Gear worth more than {money(THRESHOLD_RANDS)} is
                always checked.
              </span>
            </li>
          </ul>
        </section>
      )}

      <div aria-live="polite">
        {notice && (
          <div ref={noticeRef} className="mb-6 px-4 py-3 border border-emerald-500/30 bg-emerald-500/5 text-emerald-300 text-xs font-mono">
            <p>{notice}</p>
            {reviewReasons.length > 0 && (
              <>
                <p className="mt-2 text-emerald-200">A person will review it because:</p>
                <ul className="mt-1 space-y-1">
                  {reviewReasons.map((r) => (
                    <li key={r}>- {r}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {error && (
        <div
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="mb-6 px-4 py-3 bg-red-950 border border-red-700/40 text-red-400 text-xs font-mono focus:outline-none"
        >
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

      <div ref={panelRef} className="scroll-mt-24" />

      {/* ── Step 1: photo ─────────────────────────────────────────────────── */}
      {mode === 'photos' && (
        <Card className="p-6 mb-8">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-xs font-mono uppercase tracking-widest text-white mb-4">New listing</h3>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          <StepIndicator step={1} />
          <p className="text-sm font-mono text-neutral-300 mb-4">
            Start with a clear photo of the gear. We can suggest the details and a price from it; you check everything
            before it goes anywhere.
          </p>
          {photoUploader}
          <div className="flex flex-wrap gap-3 mt-6">
            <Button onClick={suggestDetails} loading={suggesting} disabled={uploading || images.length === 0} className="min-h-[44px]">
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              Suggest details from photo
            </Button>
            <Button variant="outline" onClick={fillInMyself} disabled={uploading || suggesting} className="min-h-[44px]">
              Fill in details myself
            </Button>
          </div>
          {suggesting && (
            <p className="mt-3 text-xs font-mono text-neutral-400" role="status">
              Looking at your photo. This can take up to a minute.
            </p>
          )}
        </Card>
      )}

      {/* ── Step 2: details and price ─────────────────────────────────────── */}
      {mode === 'details' && (
        <Card className="p-6 mb-8">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-xs font-mono uppercase tracking-widest text-white mb-4">
              {editingId ? 'Listing details' : 'New listing'}
            </h3>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          <StepIndicator step={2} />

          {editing && lowConfidenceId === editing.id && (
            <p className="mb-4 px-4 py-3 border border-amber-500/30 bg-amber-500/5 text-amber-300 text-xs font-mono">
              We were not sure what this is. Check every detail carefully.
            </p>
          )}

          {/* AI suggestions still to check */}
          {editing && pendingAi.length > 0 && (
            <section aria-labelledby="ai-heading" className="mb-6 border border-[#D4A843]/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <h4 id="ai-heading" className="text-xs font-mono text-[#D4A843] uppercase tracking-widest">
                  Suggestions to check ({pendingAi.length})
                </h4>
                <button
                  type="button"
                  onClick={() => confirmAi(editing, pendingAi)}
                  disabled={busyId === editing.id || saving}
                  className="min-h-[44px] px-4 inline-flex items-center gap-2 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-90 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  Confirm all suggestions
                </button>
              </div>
              <p className="text-xs font-mono text-neutral-400 mb-3">
                These were suggested from your photo and may be wrong. Change any that are wrong in the form below (a
                change counts as checked), or confirm the ones that are right. A listing cannot be submitted until every
                suggestion is checked.
              </p>
              <ul className="space-y-1">
                {pendingAi.map((field) => (
                  <li key={field} className="flex items-center justify-between gap-3 text-xs font-mono">
                    <span className="text-neutral-300 min-w-0">
                      <span className="text-neutral-500 uppercase tracking-widest">{FIELD_LABELS[field]}: </span>
                      <span className="break-words">{aiValue(editing, field)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => confirmAi(editing, [field])}
                      disabled={busyId === editing.id || saving}
                      aria-label={`${FIELD_LABELS[field]} looks right`}
                      className="flex-shrink-0 min-h-[44px] px-3 inline-flex items-center gap-1 border border-[#D4A843]/40 text-[#D4A843] hover:bg-[#D4A843]/10 transition-colors disabled:opacity-50"
                    >
                      <Check className="w-3 h-3" aria-hidden="true" />
                      Looks right
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="mb-6">{photoUploader}</div>

          <p className="text-xs font-mono text-neutral-500 mb-4">
            <span className="text-red-400" aria-hidden="true">*</span> Required to submit. You can save a draft with only a
            photo, a title and a category.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="listing-title" className={LABEL_CLASS}>
                Title <Required /> {isAi('title') && <AiMark />}
              </label>
              <input
                id="listing-title"
                type="text"
                required
                aria-required="true"
                aria-invalid={errorField === 'title' || undefined}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Sony A7 III body"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label htmlFor="listing-category" className={LABEL_CLASS}>
                Category <Required /> {isAi('category') && <AiMark />}
              </label>
              <select
                id="listing-category"
                required
                aria-required="true"
                aria-invalid={errorField === 'category' || undefined}
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className={INPUT_CLASS}
              >
                <option value="">Choose a category</option>
                {RENTAL_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="listing-brand" className={LABEL_CLASS}>
                Brand {isAi('brand') && <AiMark />}
              </label>
              <input
                id="listing-brand"
                type="text"
                aria-invalid={errorField === 'brand' || undefined}
                value={form.brand}
                onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                placeholder="e.g. Sony"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label htmlFor="listing-model" className={LABEL_CLASS}>
                Model {isAi('model') && <AiMark />}
              </label>
              <input
                id="listing-model"
                type="text"
                aria-invalid={errorField === 'model' || undefined}
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                placeholder="e.g. A7 III"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label htmlFor="listing-condition" className={LABEL_CLASS}>
                Condition {isAi('condition') && <AiMark />}
              </label>
              <select
                id="listing-condition"
                aria-invalid={errorField === 'condition' || undefined}
                value={form.condition}
                onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))}
                className={INPUT_CLASS}
              >
                <option value="">Choose a condition</option>
                {LISTING_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {conditionLabel(c)}
                  </option>
                ))}
                {form.condition && !(LISTING_CONDITIONS as readonly string[]).includes(form.condition) && (
                  <option value={form.condition}>{form.condition}</option>
                )}
              </select>
            </div>

            <div>
              <label htmlFor="listing-day-rate" className={LABEL_CLASS}>
                Day rate ({STUDIO.currency.code}) <Required /> {isAi('price_per_day') && <AiMark />}
              </label>
              <input
                id="listing-day-rate"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                required
                aria-required="true"
                aria-invalid={errorField === 'price_per_day' || undefined}
                aria-describedby="listing-day-rate-hint"
                value={form.price_per_day}
                onChange={(e) => setForm((f) => ({ ...f, price_per_day: e.target.value }))}
                placeholder="e.g. 500"
                className={INPUT_CLASS}
              />
              <p id="listing-day-rate-hint" className={HINT_CLASS}>
                {isAi('price_per_day') ? 'A starting point for this kind of gear. Set your own price if you prefer.' : 'What a renter pays per day.'}
              </p>
            </div>

            <div>
              <label htmlFor="listing-replacement-value" className={LABEL_CLASS}>
                Replacement value ({STUDIO.currency.code}) <Required /> {isAi('replacement_value') && <AiMark />}
              </label>
              <input
                id="listing-replacement-value"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                required
                aria-required="true"
                aria-invalid={errorField === 'replacement_value' || undefined}
                aria-describedby="listing-replacement-value-hint"
                value={form.replacement_value}
                onChange={(e) => setForm((f) => ({ ...f, replacement_value: e.target.value }))}
                placeholder="What it would cost to replace today"
                className={INPUT_CLASS}
              />
              <p id="listing-replacement-value-hint" className={HINT_CLASS}>
                We do not guess this: enter what the same item (or the nearest equivalent) costs to buy today.{' '}
                {deposit !== null
                  ? `Renter deposit: ${money(deposit)} (worked out from this value; you do not set it).`
                  : 'The renter deposit is worked out from this value.'}
              </p>
            </div>

            <div>
              <label htmlFor="listing-location" className={LABEL_CLASS}>
                Location (suburb and city) <Required />
              </label>
              <input
                id="listing-location"
                type="text"
                required
                aria-required="true"
                aria-invalid={errorField === 'location' || undefined}
                aria-describedby="listing-location-hint"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                placeholder="e.g. Braamfontein, Johannesburg"
                className={INPUT_CLASS}
              />
              <p id="listing-location-hint" className={HINT_CLASS}>
                {homeLocation && form.location === homeLocation
                  ? 'Filled in from your profile. Change it if the gear is kept somewhere else. '
                  : ''}
                Only what you type here is shown.
              </p>
            </div>
          </div>

          <div className="mb-4">
            <label htmlFor="listing-description" className={LABEL_CLASS}>
              Description {isAi('description') && <AiMark />}
            </label>
            <textarea
              id="listing-description"
              aria-invalid={errorField === 'description' || undefined}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder="What it is good for, anything a renter should know"
              className={`${INPUT_CLASS} resize-none`}
            />
          </div>

          {/* Optional fields, collapsed */}
          <details
            className="mb-6 border border-white/10"
            open={['price_per_week', 'rental_includes', 'serial_number', 'replacement_value_evidence'].includes(errorField ?? '') || undefined}
          >
            <summary className="min-h-[44px] px-4 flex items-center gap-2 cursor-pointer text-xs font-mono uppercase tracking-widest text-neutral-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A843]">
              More details (optional)
              {pendingInMore.length > 0 && (
                <span className="normal-case tracking-normal text-[#D4A843]">
                  {pendingInMore.length} suggestion{pendingInMore.length === 1 ? '' : 's'} to check
                </span>
              )}
            </summary>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 pt-2">
              <div>
                <label htmlFor="listing-week-rate" className={LABEL_CLASS}>
                  Week rate ({STUDIO.currency.code}) {isAi('price_per_week') && <AiMark />}
                </label>
                <input
                  id="listing-week-rate"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  aria-invalid={errorField === 'price_per_week' || undefined}
                  aria-describedby="listing-week-rate-hint"
                  value={form.price_per_week}
                  onChange={(e) => setForm((f) => ({ ...f, price_per_week: e.target.value }))}
                  placeholder="Charged per full week of a hire"
                  className={INPUT_CLASS}
                />
                <p id="listing-week-rate-hint" className={HINT_CLASS}>
                  Charged for each full 7 days. Cannot be more than 7 days at the day rate. Leave blank to charge the day
                  rate.
                </p>
              </div>

              <div>
                <label htmlFor="listing-includes" className={LABEL_CLASS}>
                  What&rsquo;s included {isAi('rental_includes') && <AiMark />}
                </label>
                <textarea
                  id="listing-includes"
                  aria-invalid={errorField === 'rental_includes' || undefined}
                  aria-describedby="listing-includes-hint"
                  value={form.rental_includes}
                  onChange={(e) => setForm((f) => ({ ...f, rental_includes: e.target.value }))}
                  rows={3}
                  placeholder={'One item per line, e.g.\n2 batteries\nCharger'}
                  className={`${INPUT_CLASS} resize-none`}
                />
                <p id="listing-includes-hint" className={HINT_CLASS}>
                  One item per line.
                </p>
              </div>

              <div>
                <label htmlFor="listing-serial" className={LABEL_CLASS}>
                  Serial number
                </label>
                <input
                  id="listing-serial"
                  type="text"
                  aria-invalid={errorField === 'serial_number' || undefined}
                  aria-describedby="listing-serial-hint"
                  value={form.serial_number}
                  onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value }))}
                  placeholder="Kept for theft reports"
                  className={INPUT_CLASS}
                />
                <p id="listing-serial-hint" className={HINT_CLASS}>
                  Not shown on the listing page.
                </p>
              </div>

              <div>
                <label htmlFor="listing-evidence" className={LABEL_CLASS}>
                  Replacement value evidence
                </label>
                <input
                  id="listing-evidence"
                  type="text"
                  aria-invalid={errorField === 'replacement_value_evidence' || undefined}
                  value={form.replacement_value_evidence}
                  onChange={(e) => setForm((f) => ({ ...f, replacement_value_evidence: e.target.value }))}
                  placeholder="Link to a current price, or a short note"
                  className={INPUT_CLASS}
                />
              </div>
            </div>
          </details>

          <div className="flex flex-wrap gap-3">
            <Button onClick={save} loading={saving} disabled={uploading || images.length === 0 || (editing !== null && busyId === editing.id)} className="min-h-[44px]">
              Save and continue
            </Button>
            <Button variant="outline" onClick={close} className="min-h-[44px]">
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* ── Step 3: submit ────────────────────────────────────────────────── */}
      {mode === 'submit' && submitting && (
        <SubmitStep
          listing={submitting}
          precheck={precheck}
          precheckState={precheckState}
          verificationStatus={verificationStatus}
          attest={attest}
          setAttest={setAttest}
          busy={busyId === submitting.id}
          onSubmit={() => submit(submitting)}
          onEdit={() => openEdit(submitting)}
          onClose={close}
          onRetry={() => loadPrecheck(submitting.id)}
        />
      )}

      {/* Hires of this owner's gear and their payouts (renters' details never shown) */}
      {mode === 'list' && <OwnerHires />}

      {/* ── Listings ─────────────────────────────────────────────────────── */}
      {listings.length === 0 && mode === 'list' ? (
        <EmptyState
          title="No listings yet"
          description="Start with a photo of your gear. You can save a draft before your ID check."
          action={{ label: 'List new gear', onClick: startNew }}
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
                      <img src={listing.gallery[0].url} alt="" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-20 h-20 flex-shrink-0 bg-neutral-900 flex items-center justify-center">
                      <Package className="w-6 h-6 text-neutral-400" aria-hidden="true" />
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 flex-1 min-w-0 p-5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="text-sm font-medium text-white truncate">{listing.title}</h3>
                        <Badge variant={status.variant}>{status.label}</Badge>
                        {listing.is_ai_generated && (
                          <span className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-widest text-[#D4A843] border border-[#D4A843]/30 px-1.5 py-0.5">
                            <Sparkles className="w-2.5 h-2.5" aria-hidden="true" />
                            AI drafted
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                        {RENTAL_CATEGORIES.find((c) => c.value === listing.category)?.label ?? listing.category}
                        {listing.sub_category ? ` / ${conditionLabel(listing.sub_category)}` : ''}
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
                          Suggested, not yet checked: {unconfirmed.map((f) => FIELD_LABELS[f]).join(', ')}
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
                            type="button"
                            onClick={() => openSubmit(listing)}
                            disabled={busy}
                            className="min-h-[44px] px-3 inline-flex items-center gap-1 text-xs font-mono uppercase tracking-widest border border-[#D4A843]/30 text-[#D4A843] hover:bg-[#D4A843]/5 hover:border-[#D4A843]/60 transition-colors disabled:opacity-50"
                          >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Send className="w-3.5 h-3.5" aria-hidden="true" />}
                            Submit
                          </button>
                        )}
                        {canTakeDown && (
                          <button
                            type="button"
                            onClick={() => unpublish(listing)}
                            disabled={busy}
                            title={listing.listing_status === 'published' ? 'Take down' : 'Withdraw from review'}
                            aria-label={`${listing.listing_status === 'published' ? 'Take down' : 'Withdraw from review'}: ${listing.title}`}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-white/10 text-neutral-400 hover:border-white/30 hover:text-white transition-colors disabled:opacity-50"
                          >
                            <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                        {listing.listing_status !== 'suspended' && (
                          <button
                            type="button"
                            onClick={() => openEdit(listing)}
                            title="Edit"
                            aria-label={`Edit ${listing.title}`}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-white/10 text-neutral-400 hover:border-white/30 hover:text-white transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => softDelete(listing.id)}
                          title="Delete"
                          aria-label={`Delete ${listing.title}`}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-red-900/40 text-red-600 hover:border-red-500/40 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
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

// ── Step 3 ────────────────────────────────────────────────────────────────────

function SubmitStep({
  listing,
  precheck,
  precheckState,
  verificationStatus,
  attest,
  setAttest,
  busy,
  onSubmit,
  onEdit,
  onClose,
  onRetry,
}: {
  listing: Listing;
  precheck: Precheck | null;
  precheckState: 'idle' | 'loading' | 'error';
  verificationStatus: VerificationStatus | null;
  attest: Attest;
  setAttest: React.Dispatch<React.SetStateAction<Attest>>;
  busy: boolean;
  onSubmit: () => void;
  onEdit: () => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const allTicked = attest.owns_or_authorised && attest.condition_working && attest.location_accurate;
  // The declarations are given right here, so their block is not repeated.
  const fieldBlocks = (precheck?.listingBlocks ?? []).filter((b) => b.code !== 'missing_attestations');
  const ownerBlocks = precheck?.ownerBlocks ?? [];
  const blocked = Boolean(precheck && (precheck.statusBlock || ownerBlocks.length > 0 || fieldBlocks.length > 0));
  const reviewed = precheck ? precheck.review.required : true;

  return (
    <Card className="p-6 mb-8">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xs font-mono uppercase tracking-widest text-white mb-4">Submit: {listing.title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <StepIndicator step={3} />

      {precheckState === 'loading' && (
        <p className="mb-4 flex items-center gap-2 text-xs font-mono text-neutral-400" role="status">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          Checking what is still needed...
        </p>
      )}
      {precheckState === 'error' && (
        <p className="mb-4 text-xs font-mono text-red-400" role="alert">
          We could not check this listing just now. You can still submit; we check everything again when you do.{' '}
          <button type="button" onClick={onRetry} className="underline min-h-[44px]">
            Check again
          </button>
        </p>
      )}

      {precheck && (ownerBlocks.length > 0 || fieldBlocks.length > 0 || precheck.statusBlock) && (
        <section aria-labelledby="still-needed" className="mb-6 border border-amber-500/30 bg-amber-500/5 p-4">
          <h4 id="still-needed" className="text-xs font-mono uppercase tracking-widest text-amber-300 mb-2">
            Still needed before it can go live
          </h4>
          <ul className="space-y-2 text-xs font-mono text-amber-200">
            {precheck.statusBlock && <li>- {precheck.statusBlock.message}</li>}
            {ownerBlocks.map((b) => (
              <li key={b.code}>
                -{' '}
                {b.code === 'owner_not_verified' ? (
                  verificationStatus === 'pending' ? (
                    `Your ID check is with us, ${STUDIO.verification.reviewTime}.`
                  ) : (
                    <>
                      Finish your ID check.{' '}
                      <Link href="/dashboard/verification" className="underline">
                        Do the ID check
                      </Link>
                    </>
                  )
                ) : b.code === 'payout_not_verified' ? (
                  <>
                    A validated payout bank account (validated after your ID check; the account holder must match the
                    name on your ID).{' '}
                    <Link href="/dashboard/banking" className="underline">
                      Payout account
                    </Link>
                  </>
                ) : (
                  b.message
                )}
              </li>
            ))}
            {fieldBlocks.map((b) => (
              <li key={b.code}>
                - {b.message}{' '}
                <button type="button" onClick={onEdit} className="underline min-h-[44px]">
                  {b.code === 'unconfirmed_ai_fields' ? 'Check suggestions' : 'Edit listing'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <fieldset className="mb-6 border border-white/10 p-4">
        <legend className="px-1 text-xs font-mono uppercase tracking-widest text-neutral-400">Your declarations</legend>
        <p className="text-xs font-mono text-neutral-500 mb-3">
          Needed to submit. These are your statements; we do not inspect the gear before it goes live.
        </p>
        {DECLARATIONS.map(([key, text]) => (
          <label key={key} className="flex items-start gap-3 min-h-[44px] py-2 cursor-pointer text-xs font-mono text-neutral-300">
            <input
              type="checkbox"
              checked={attest[key]}
              onChange={(e) => setAttest((a) => ({ ...a, [key]: e.target.checked }))}
              className="mt-0.5 w-5 h-5 accent-[#D4A843] focus-visible:ring-2 focus-visible:ring-[#D4A843]"
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

      {precheck && !blocked && (
        <div className="mb-6 text-xs font-mono text-neutral-300">
          {reviewed ? (
            <>
              <p>A person will review it before it goes live, because:</p>
              <ul className="mt-1 space-y-1 text-neutral-400">
                {precheck.review.reasons.map((r) => (
                  <li key={r.code}>- {reviewReasonText(r.code, r.message)}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>It will go live as soon as you submit.</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button onClick={onSubmit} loading={busy} disabled={blocked || !allTicked} className="min-h-[44px]">
          <Send className="w-3.5 h-3.5" aria-hidden="true" />
          {reviewed ? 'Submit for review' : 'Publish'}
        </Button>
        <Button variant="outline" onClick={onEdit} className="min-h-[44px]">
          Edit details
        </Button>
        <Button variant="ghost" onClick={onClose} className="min-h-[44px]">
          Keep as draft
        </Button>
      </div>
      {!allTicked && (
        <p className={HINT_CLASS}>Tick the three declarations to submit.</p>
      )}
      {blocked && allTicked && (
        <p className={HINT_CLASS}>You can submit once everything above is done. Your draft is saved.</p>
      )}
    </Card>
  );
}
