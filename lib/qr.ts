import QRCode from 'qrcode';

/**
 * The site's own QR code, shown full screen at /qr and downloadable for print.
 *
 * It always points at the public site, even when rendered on a preview, so a
 * code downloaded for a poster never sends people to a protected preview URL.
 * The utm tags let Web Analytics count QR visits separately.
 */
export const SITE_QR_URL =
  'https://www.thabangvision.com/?utm_source=qr&utm_medium=print&utm_campaign=general';

// "M" keeps the pattern coarse enough to scan off a phone or monitor across a
// room; the quiet zone of 4 modules is what scanners expect.
const OPTIONS = { errorCorrectionLevel: 'M', margin: 4 } as const;

export function siteQrSvg(): Promise<string> {
  return QRCode.toString(SITE_QR_URL, { ...OPTIONS, type: 'svg' });
}

/** A 2048 px PNG, big enough for an A3 print. */
export function siteQrPng(): Promise<Buffer> {
  return QRCode.toBuffer(SITE_QR_URL, { ...OPTIONS, type: 'png', width: 2048 });
}
