import type { Metadata } from 'next';
import { siteQrSvg } from '@/lib/qr';
import { KeepAwake } from './KeepAwake';

export const metadata: Metadata = {
  title: 'Scan to open ThabangVision',
  robots: { index: false, follow: false },
};

/**
 * Full-screen QR code to show from a phone, laptop or projector at workshops.
 * White page, no header: the code takes as much of the screen as fits, and
 * the screen stays on while it is open.
 */
export default async function QrPage() {
  const svg = await siteQrSvg();
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white px-4 py-6 text-black">
      <KeepAwake />
      <p className="text-center text-lg font-semibold sm:text-2xl">Scan to open ThabangVision</p>
      <div
        role="img"
        aria-label="QR code for thabangvision.com"
        className="aspect-square w-[min(92vw,calc(100dvh-11rem))] [&>svg]:h-full [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="text-center text-base sm:text-xl">thabangvision.com</p>
      <div className="flex gap-3 text-sm">
        <a href="/qr/download?format=png" download className="rounded-full border border-black px-4 py-2">
          Download PNG
        </a>
        <a href="/qr/download?format=svg" download className="rounded-full border border-black px-4 py-2">
          Download SVG (print)
        </a>
      </div>
    </div>
  );
}
