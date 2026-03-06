import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Current project images (Unsplash placeholders)
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      // Cloudinary CDN — production media
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
      // YouTube thumbnails
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
      },
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
      },
    ],
  },
  // Cloudinary + Gemini secrets: no NEXT_PUBLIC_ prefix →
  // Next.js automatically excludes them from the client bundle.
};

export default nextConfig;
