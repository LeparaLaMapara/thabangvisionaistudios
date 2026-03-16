export default function cloudinaryLoader({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  if (!src.includes('res.cloudinary.com')) return src;

  const q = quality || 'auto';
  return src.replace('/image/upload/', `/image/upload/f_auto,q_${q},w_${width}/`);
}
