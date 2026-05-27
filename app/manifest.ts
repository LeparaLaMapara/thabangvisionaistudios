import type { MetadataRoute } from 'next';
import { STUDIO } from '@/lib/constants';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: STUDIO.name,
    short_name: STUDIO.shortName,
    description: STUDIO.meta.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#050505',
    theme_color: '#D4A843',
    icons: [
      { src: '/logo-favicon-32.png', sizes: '32x32', type: 'image/png' },
      { src: '/logo-favicon-180.png', sizes: '180x180', type: 'image/png' },
      { src: '/logo-black-bg.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
