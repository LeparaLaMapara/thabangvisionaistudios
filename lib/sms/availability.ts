import { sms } from '@/lib/sms';

/**
 * Whether people can confirm a phone number right now: some sender (SMS today,
 * WhatsApp once it is added) is switched on. While this is false the phone
 * step is hidden and not required, so nobody is asked for a check they cannot
 * complete.
 */
export function phoneChecksAvailable(): boolean {
  return sms.isConfigured();
}
