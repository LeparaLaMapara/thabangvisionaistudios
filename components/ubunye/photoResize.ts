'use client';

import { UBUNYE_PHOTO_POLICY } from '@/lib/constants';
import { fitWithin } from '@/lib/ubunye/chat-photos';

/**
 * Resize one chosen photo in the browser: the long side at most
 * UBUNYE_PHOTO_POLICY.maxSide, drawn on a canvas and saved as a JPEG data URL.
 * Phone photos are often 4000px and 5 MB; this keeps each one small enough
 * to read quickly. Throws when the browser cannot open the file.
 */
export async function resizePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight);
    if (!width || !height) throw new Error('empty image');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    // A transparent PNG becomes JPEG: paint the page colour under it, not black.
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', UBUNYE_PHOTO_POLICY.jpegQuality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not open the photo'));
    img.src = src;
  });
}
