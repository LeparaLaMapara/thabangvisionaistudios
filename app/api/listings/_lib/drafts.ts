import { STUDIO } from '@/lib/constants';
import { trackFunnel } from '@/lib/analytics/funnel';
import { depositForListing, listingMetadata, type ListingImage } from '@/lib/core/listings/input';
import { markAiSuggested, type AiSuggestibleField, type OwnerAttestations } from '@/lib/core/listings/review';
import { savePrivate, type Admin } from './server';

/**
 * Creating a community listing draft. One place for the dashboard form
 * (POST /api/listings), the photo-first AI suggestion (POST
 * /api/listings/suggest) and onboarding (POST /api/onboarding/create-rentals),
 * so every draft is created the same way: never public, deposit computed on
 * the server, AI flags in listing_private, and a `listing_started` funnel event.
 */

export type DraftSource = 'dashboard' | 'ai' | 'onboarding';

export interface DraftValues {
  title: string;
  description: string | null;
  category: string | null;
  /** Stored in smart_rentals.sub_category (the column the dashboard reads). */
  condition: string | null;
  brand: string | null;
  model: string | null;
  price_per_day: number | null;
  price_per_week: number | null;
  replacement_value: number | null;
  rental_includes: string[];
  serial_number: string | null;
  location: string | null;
  /** Already cleaned by the caller (metadataFreeGallery). */
  gallery: ListingImage[] | null;
  thumbnail_url: string | null;
  cover_public_id: string | null;
}

export interface DraftOptions {
  source: DraftSource;
  /** Fields whose value came from the platform, not the owner. */
  aiSuggested: readonly AiSuggestibleField[];
  attestations?: OwnerAttestations | null;
  replacementValueEvidence?: string | null;
  /** Extra metadata (GPS-like keys are dropped by listingMetadata). */
  metadata?: Record<string, unknown> | null;
  now?: Date;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

export function uniqueSlug(title: string): string {
  return `${slugify(title)}-${Date.now().toString(36)}`;
}

/**
 * Inserts a draft owned by `ownerId` and its private row. If the private row
 * cannot be written the draft is removed (its AI flags would be lost and it
 * would look owner-confirmed) and this throws. Returns the new id.
 */
export async function insertDraft(admin: Admin, ownerId: string, v: DraftValues, opts: DraftOptions): Promise<string> {
  const now = opts.now ?? new Date();
  const aiFields = opts.aiSuggested.length > 0 ? markAiSuggested(null, opts.aiSuggested, now) : null;

  const { data, error } = await admin
    .from('smart_rentals')
    .insert({
      title: v.title,
      slug: uniqueSlug(v.title),
      description: v.description,
      category: v.category,
      sub_category: v.condition,
      brand: v.brand,
      model: v.model,
      price_per_day: v.price_per_day,
      price_per_week: v.price_per_week,
      replacement_value: v.replacement_value,
      deposit_amount: depositForListing(v.replacement_value),
      rental_includes: v.rental_includes,
      serial_number: v.serial_number,
      currency: STUDIO.currency.code,
      thumbnail_url: v.thumbnail_url,
      cover_public_id: v.cover_public_id,
      gallery: v.gallery,
      metadata: listingMetadata(opts.metadata ?? null, v.location),
      owner_type: 'community',
      owner_id: ownerId,
      listing_status: 'draft',
      is_published: false,
      is_available: true,
      is_ai_generated: opts.aiSuggested.length > 0,
      quantity: 1,
      ranking_score: 0,
    })
    .select('id')
    .single();
  if (error) throw error;
  const id = (data as { id: string }).id;

  try {
    await savePrivate(admin, id, {
      ai_fields: aiFields,
      owner_attestations: opts.attestations ?? null,
      replacement_value_evidence: opts.replacementValueEvidence ?? null,
    });
  } catch (privErr) {
    // Nothing can reference a row created a moment ago.
    await admin.from('smart_rentals').delete().eq('id', id).eq('owner_id', ownerId);
    throw privErr;
  }

  trackFunnel('listing_started', { userId: ownerId, meta: { listingId: id, source: opts.source } });
  return id;
}
