import { currentPhoneVerifyChannel } from '@/lib/phone-verify';

/**
 * Whether people can confirm a phone number right now: a channel (SMS, or the
 * inbound WhatsApp check, lib/phone-verify) is switched on. While this is
 * false the phone step is hidden and not required, so nobody is asked for a
 * check they cannot complete.
 */
export function phoneChecksAvailable(): boolean {
  return currentPhoneVerifyChannel() !== 'off';
}
