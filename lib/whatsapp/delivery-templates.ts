import type { RentalNoticeKind } from '@/lib/core/rental/notifications';

/**
 * WhatsApp message templates for delivery updates. DORMANT: nothing sends
 * these yet (TASK-083).
 *
 * WhatsApp only lets a business start a conversation with a template Meta has
 * approved. These are written for the "Utility" category (updates about
 * something the customer already bought), which Meta approves for order and
 * delivery updates. Each {{n}} is filled in order from `params`.
 *
 * To switch on: verify the business with Meta, submit each template under
 * its `name` in WhatsApp Manager with this exact body, wait for approval, then
 * add a 'whatsapp' channel for these kinds in NOTICE_CHANNELS and a sender in
 * lib/rental/notify.ts. Plain words, no dashes, no prices.
 */
export interface DeliveryWhatsAppTemplate {
  /** Template name as submitted to Meta (lowercase, underscores). */
  name: string;
  category: 'UTILITY';
  language: 'en';
  /** The notice this template replaces on WhatsApp. */
  kind: RentalNoticeKind;
  body: string;
  /** What fills {{1}}, {{2}}, ... in order. */
  params: readonly ('first_name' | 'driver_name' | 'pin' | 'tracking_url' | 'booking_url' | 'bank_details_url')[];
}

export const DELIVERY_WHATSAPP_TEMPLATES: readonly DeliveryWhatsAppTemplate[] = [
  {
    name: 'tv_delivery_on_the_way',
    category: 'UTILITY',
    language: 'en',
    kind: 'delivery_on_the_way',
    body: 'Hi {{1}}, your ThabangVision gear is on the way with {{2}}. Your PIN for the driver is {{3}}. Give it only when they hand you the gear. Follow the driver live: {{4}}',
    params: ['first_name', 'driver_name', 'pin', 'tracking_url'],
  },
  {
    name: 'tv_delivery_delivered',
    category: 'UTILITY',
    language: 'en',
    kind: 'delivery_delivered',
    body: 'Hi {{1}}, the driver reports your ThabangVision gear delivered. Please check every item and confirm, or report a problem, on your booking: {{2}}',
    params: ['first_name', 'booking_url'],
  },
  {
    name: 'tv_delivery_attempt_failed',
    category: 'UTILITY',
    language: 'en',
    kind: 'delivery_attempt_failed',
    body: 'Hi {{1}}, the driver could not hand over your ThabangVision gear, so it is coming back to us. We will contact you to arrange the next step. Your booking: {{2}}',
    params: ['first_name', 'booking_url'],
  },
  {
    name: 'tv_return_pickup_reminder',
    category: 'UTILITY',
    language: 'en',
    kind: 'delivery_return_reminder',
    body: 'Hi {{1}}, your ThabangVision return pickup is coming up. Please have every item and accessory packed and ready. Details: {{2}}',
    params: ['first_name', 'booking_url'],
  },
  {
    // Not a delivery update, but the same kind of utility message: a card
    // refund was refused and the renter must add a bank account (refund_failed).
    name: 'tv_refund_needs_bank_details',
    category: 'UTILITY',
    language: 'en',
    kind: 'refund_failed',
    body: 'Hi {{1}}, we could not refund your ThabangVision payment to the card you paid with. The card may be cancelled or replaced. Please add your bank details so we can pay it into your account: {{2}}',
    params: ['first_name', 'bank_details_url'],
  },
];
