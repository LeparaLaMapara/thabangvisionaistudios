import crypto from 'crypto';

// ─── Config ─────────────────────────────────────────────────────────────────

const PAYFAST_SANDBOX_URL = 'https://sandbox.payfast.co.za/eng/process';
const PAYFAST_PRODUCTION_URL = 'https://www.payfast.co.za/eng/process';
const PAYFAST_SANDBOX_VALIDATE_URL = 'https://sandbox.payfast.co.za/eng/query/validate';
const PAYFAST_PRODUCTION_VALIDATE_URL = 'https://www.payfast.co.za/eng/query/validate';

const merchantId = process.env.PAYFAST_MERCHANT_ID;
const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
const passphrase = process.env.PAYFAST_PASSPHRASE ?? '';
const isSandbox = process.env.NEXT_PUBLIC_PAYFAST_SANDBOX === 'true';

if (!merchantId || !merchantKey) {
  console.warn(
    '[PayFast] PAYFAST_MERCHANT_ID or PAYFAST_MERCHANT_KEY is not set. PayFast calls will fail at runtime.',
  );
}

/**
 * Returns true when PayFast credentials are configured.
 */
export function isPayFastConfigured(): boolean {
  return !!process.env.PAYFAST_MERCHANT_ID && !!process.env.PAYFAST_MERCHANT_KEY;
}

/**
 * Returns the PayFast process URL (sandbox or production).
 */
export function getPayFastUrl(): string {
  return isSandbox ? PAYFAST_SANDBOX_URL : PAYFAST_PRODUCTION_URL;
}

/**
 * Returns the PayFast validation URL (sandbox or production).
 */
export function getPayFastValidateUrl(): string {
  return isSandbox ? PAYFAST_SANDBOX_VALIDATE_URL : PAYFAST_PRODUCTION_VALIDATE_URL;
}

// ─── Signature generation ───────────────────────────────────────────────────

/**
 * Generates a PayFast signature from a parameter object.
 * Parameters are sorted alphabetically, URL-encoded, and hashed with MD5.
 * The passphrase is appended before hashing if set.
 */
export function generateSignature(
  params: Record<string, string>,
): string {
  // Build the query string from sorted params (exclude 'signature' if present)
  const paramString = Object.keys(params)
    .filter((key) => key !== 'signature' && params[key] !== '')
    .sort()
    .map((key) => `${key}=${encodeURIComponent(params[key]).replace(/%20/g, '+')}`)
    .join('&');

  const stringToHash = passphrase
    ? `${paramString}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`
    : paramString;

  return crypto.createHash('md5').update(stringToHash).digest('hex');
}

/**
 * Validates a PayFast signature from ITN data.
 */
export function validateSignature(
  params: Record<string, string>,
  receivedSignature: string,
): boolean {
  const expected = generateSignature(params);
  // H8: Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(receivedSignature),
    );
  } catch {
    // Buffers of different length throw — signatures don't match
    return false;
  }
}

// ─── Payment data builders ──────────────────────────────────────────────────

export type PayFastPaymentData = {
  merchant_id: string;
  merchant_key: string;
  return_url: string;
  cancel_url: string;
  notify_url: string;
  amount: string;
  item_name: string;
  item_description?: string;
  email_address?: string;
  m_payment_id?: string;
  custom_str1?: string;
  custom_str2?: string;
  custom_str3?: string;
  custom_str4?: string;
  custom_str5?: string;
  custom_int1?: string;
  custom_int2?: string;
  signature?: string;
};

type BuildPaymentParams = {
  amount: number;
  itemName: string;
  itemDescription?: string;
  email?: string;
  /** Your internal payment/order ID for reconciliation */
  paymentId?: string;
  returnUrl: string;
  cancelUrl: string;
  /** Custom metadata fields (up to 5 strings, 5 ints) */
  customStr1?: string;
  customStr2?: string;
  customStr3?: string;
  customStr4?: string;
  customStr5?: string;
  customInt1?: string;
  customInt2?: string;
};

/**
 * Builds a signed PayFast payment data object ready for form submission.
 * Amount should be in ZAR (e.g. 150.00), NOT cents.
 */
export function buildPaymentData(params: BuildPaymentParams): PayFastPaymentData {
  if (!merchantId || !merchantKey) {
    throw new Error('PayFast merchant credentials not configured');
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  // M6: Warn if notify_url will point to localhost in production
  if (!isSandbox && appUrl.includes('localhost')) {
    console.error(
      '[PayFast] CRITICAL: NEXT_PUBLIC_APP_URL contains "localhost" but sandbox mode is OFF. ' +
      'PayFast ITN notifications will fail. Set NEXT_PUBLIC_APP_URL to a publicly accessible HTTPS URL.',
    );
    throw new Error('NEXT_PUBLIC_APP_URL must be a public URL in production');
  }

  const data: Record<string, string> = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: params.returnUrl.startsWith('http') ? params.returnUrl : `${appUrl}${params.returnUrl}`,
    cancel_url: params.cancelUrl.startsWith('http') ? params.cancelUrl : `${appUrl}${params.cancelUrl}`,
    notify_url: `${appUrl}/api/webhooks/payfast`,
    amount: params.amount.toFixed(2),
    item_name: params.itemName.slice(0, 100),
  };

  if (params.itemDescription) data.item_description = params.itemDescription.slice(0, 255);
  if (params.email) data.email_address = params.email;
  if (params.paymentId) data.m_payment_id = params.paymentId;
  if (params.customStr1) data.custom_str1 = params.customStr1;
  if (params.customStr2) data.custom_str2 = params.customStr2;
  if (params.customStr3) data.custom_str3 = params.customStr3;
  if (params.customStr4) data.custom_str4 = params.customStr4;
  if (params.customStr5) data.custom_str5 = params.customStr5;
  if (params.customInt1) data.custom_int1 = params.customInt1;
  if (params.customInt2) data.custom_int2 = params.customInt2;

  data.signature = generateSignature(data);

  return data as PayFastPaymentData;
}

// ─── ITN validation ─────────────────────────────────────────────────────────

/**
 * Validates the PayFast server IP to ensure ITN comes from PayFast.
 * PayFast sends ITN from specific IP ranges.
 */
const PAYFAST_IPS = [
  '197.97.145.144/28',
  '41.74.179.192/27',
];

/**
 * Check if an IP is within a CIDR range using proper bit-level matching.
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const [rangeIp, bits] = cidr.split('/');
  const mask = bits ? ~((1 << (32 - parseInt(bits, 10))) - 1) >>> 0 : 0xFFFFFFFF;

  const ipToNum = (addr: string): number => {
    const parts = addr.split('.').map(Number);
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  };

  return (ipToNum(ip) & mask) === (ipToNum(rangeIp) & mask);
}

/**
 * Check if an IP is from PayFast using proper CIDR matching.
 */
export function isPayFastIP(ip: string): boolean {
  // In sandbox mode, allow any IP for testing
  if (isSandbox) return true;

  return PAYFAST_IPS.some((range) => ipInCidr(ip, range));
}

/**
 * Validates ITN data by making a server-to-server call to PayFast.
 */
export async function validateITN(
  params: Record<string, string>,
): Promise<boolean> {
  const validateUrl = getPayFastValidateUrl();

  const paramString = Object.keys(params)
    .filter((key) => key !== 'signature')
    .sort()
    .map((key) => `${key}=${encodeURIComponent(params[key]).replace(/%20/g, '+')}`)
    .join('&');

  try {
    const response = await fetch(validateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: paramString,
    });

    const text = await response.text();
    return text.trim() === 'VALID';
  } catch (err) {
    console.error('[PayFast] ITN validation request failed:', err);
    return false;
  }
}

// ─── Payment status types ───────────────────────────────────────────────────

export type PayFastPaymentStatus = 'COMPLETE' | 'FAILED' | 'PENDING';

export type PayFastITNPayload = {
  m_payment_id: string;
  pf_payment_id: string;
  payment_status: PayFastPaymentStatus;
  item_name: string;
  item_description: string;
  amount_gross: string;
  amount_fee: string;
  amount_net: string;
  custom_str1: string;
  custom_str2: string;
  custom_str3: string;
  custom_str4: string;
  custom_str5: string;
  custom_int1: string;
  custom_int2: string;
  name_first: string;
  name_last: string;
  email_address: string;
  merchant_id: string;
  signature: string;
};
