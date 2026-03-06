// PLACEHOLDER — paste types/equipment.ts here (no changes needed from Vite source).
// The file is identical between Vite and Next.js.

export type Category = 'anamorphic' | 'spherical' | 'large-format' | 'camera' | 'lighting' | 'grip';

export interface Equipment {
  id: string;
  slug: string;
  name: string;
  category: Category;
  featured: boolean;
  tagline: string;
  specs: {
    tStop: string;
    closeFocus: string;
    frontDiameter: string;
    squeezeRatio?: string;
    weight: string;
    coverage: string[];
    mount: string[];
    focalLengths?: string[];
  };
  media: {
    heroImage: string;
    gallery: string[];
  };
  description: string;
}

export type ProjectType = 'film' | 'photography';

export interface Project {
  id: string;
  slug: string;
  title: string;
  client?: string;
  year?: string;
  type: ProjectType;
  subCategory: string;
  thumbnail: string;
  tags: string[];
  videoId?: string;
  description?: string;
  credits?: { role: string; name: string }[];
  gallery?: string[];
}

export interface NavItem {
  label: string;
  href: string;
  children?: NavItem[];
}

export interface RentalProduct {
  id: string;
  name: string;
  brand: string;
  categorySlug: string;
  type: string;
  image: string;
  specs: string[];
  dailyRate: number;
  weeklyRate: number;
  inStock: boolean;
  isNew: boolean;
}
