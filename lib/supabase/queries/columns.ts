/**
 * Column lists for reads whose result goes back to a signed-in user.
 *
 * Plain strings with no imports, so browser components can use them too.
 * Each list is what the screens use and what that person may see: never `*`,
 * which would hand over staff notes, payment provider codes, payout
 * references, the platform's share or fraud-check data (audit 2026-10-13).
 * A column added to a table stays private until it is added here.
 */

/**
 * A client's view of their own service booking (GET /api/service-bookings).
 * Left out on purpose: admin_notes, client_email, paystack_reference,
 * paystack_access_code, provider_reference, platform_commission,
 * platform_amount, paystack_fee_estimate, creator_amount, payout_reference,
 * payout_provider, payout_retry_count, payout_claimed_at, payout_last_error,
 * payout_due_at, paid_out_at, cancellation_refund_error.
 * payout_status stays: the client timeline shows "Creator paid".
 */
export const CLIENT_SERVICE_BOOKING_COLUMNS = [
  'id',
  'reference',
  'creator_id',
  'booking_type',
  'project_category',
  'project_description',
  'deliverables',
  'duration_hours',
  'location',
  'preferred_dates',
  'shoot_date',
  'subtotal',
  'vat',
  'total',
  'payment_status',
  'payout_status',
  'status',
  'created_at',
  'updated_at',
  'paid_at',
  'accepted_at',
  'arrived_at',
  'delivered_at',
  'completed_at',
  'cancelled_at',
  'cancellation_reason',
  'cancellation_refund_amount',
  'cancellation_refund_percent',
  'cancellation_refund_status',
  'cancellation_refunded_at',
  'delivery_url',
  'delivery_message',
  'client_rating',
  'client_review',
  'declined_at',
  'decline_reason',
  'revisions_included',
  'revisions_used',
  'revision_policy',
  'cancellation_policy',
  'accepted_by_client_at',
  'dispute_window_ends_at',
].join(', ');

/**
 * A renter's view of their own gear bookings (GET /api/bookings).
 * Left out on purpose: notes (staff), owner_id, owner_share_cents,
 * platform_share_cents, unit_replacement_value_cents, payfast_payment_id,
 * provider_reference, return_reviewed_by, cancellation_refund_error.
 */
export const RENTER_EQUIPMENT_BOOKING_COLUMNS = [
  'id',
  'user_id',
  'rental_id',
  'checkout_group_id',
  'start_date',
  'end_date',
  'quantity',
  'status',
  'currency',
  'total_price',
  'deposit_amount',
  'hire_cents',
  'deposit_cents',
  'delivery_fee',
  'amount_due',
  'balance_due',
  'payment_plan',
  'payment_method',
  'fulfilment_method',
  'requires_manual_approval',
  'hold_expires_at',
  'created_at',
  'updated_at',
  'cancelled_at',
  'cancel_reason',
  'completed_at',
  'returned_at',
  'cancellation_fee',
  'cancellation_refund_amount',
  'cancellation_refund_percent',
  'cancellation_refund_status',
  'cancellation_refunded_at',
  'deposit_released',
  'deposit_released_at',
  'late_fee',
  'damage_fee',
].join(', ');

/**
 * What the profile editor reads of the user's own profile
 * (app/(platform)/dashboard/profile). Left out on purpose: the verification
 * evidence (verification_ai_check, verification_fraud_flags,
 * verification_metadata, verification_ip, verification_user_agent,
 * id_document_hash, id_front_path, id_back_path, selfie_with_id_path),
 * POPIA consent IP, role and suspension fields.
 */
export const OWN_PROFILE_EDITOR_COLUMNS = [
  'id',
  'first_name',
  'last_name',
  'bio',
  'phone',
  'phone_verified_at',
  'avatar_url',
  'skills',
  'social_links',
  'street_address',
  'city',
  'province',
  'postal_code',
  'country',
  'address_lat',
  'address_lng',
  'address_place_id',
  'available_for_hire',
  'hourly_rate',
  'crew_bio',
  'years_experience',
  'specializations',
  'is_verified',
  'verification_status',
  'portfolio_projects',
].join(', ');
