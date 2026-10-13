import { NextRequest, NextResponse } from 'next/server';
import { siteQrPng, siteQrSvg } from '@/lib/qr';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const format = request.nextUrl.searchParams.get('format');
  if (format === 'svg') {
    return new NextResponse(await siteQrSvg(), {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Content-Disposition': 'attachment; filename="thabangvision-qr.svg"',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }
  return new NextResponse(new Uint8Array(await siteQrPng()), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="thabangvision-qr.png"',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
