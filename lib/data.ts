import { Equipment, Project, RentalProduct } from '@/types/equipment';

export const featuredEquipment: Equipment[] = [
  {
    id: '1',
    slug: 'c-series-anamorphic',
    name: 'C-Series Anamorphic',
    category: 'anamorphic',
    featured: true,
    tagline: 'Classic anamorphic characteristics with modern reliability.',
    specs: {
      tStop: 'T2.3 - T3.5',
      closeFocus: '0.76m - 1.5m',
      frontDiameter: '95mm',
      squeezeRatio: '2.0x',
      weight: '1.6 - 2.7 kg',
      coverage: ['Super 35'],
      mount: ['PV'],
      focalLengths: ['35mm', '40mm', '50mm', '60mm', '75mm', '100mm']
    },
    media: {
      heroImage: 'https://images.unsplash.com/photo-1626847037657-fd3622613ce3?q=80&w=2900&auto=format&fit=crop',
      gallery: ['https://images.unsplash.com/photo-1626847037657-fd3622613ce3?q=80&w=800&auto=format&fit=crop']
    },
    description: "The C-Series Anamorphic primes are lightweight, compact, and offer the classic anamorphic look with organic flares, oval bokeh, and subtle distortion that cinematographers have loved for decades."
  },
  {
    id: '2',
    slug: 'system-65',
    name: 'System 65',
    category: 'large-format',
    featured: true,
    tagline: 'The ultimate large format experience.',
    specs: {
      tStop: 'T2.5',
      closeFocus: '0.9m',
      frontDiameter: '114mm',
      weight: '2.3 kg',
      coverage: ['65mm', 'Large Format'],
      mount: ['PV 65'],
      focalLengths: ['35mm', '55mm', '80mm', '120mm']
    },
    media: {
      heroImage: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?q=80&w=2800&auto=format&fit=crop',
      gallery: ['https://images.unsplash.com/photo-1516035069371-29a1b244cc32?q=80&w=800&auto=format&fit=crop']
    },
    description: "System 65 lenses offer unparalleled resolution and clarity for large format cinematography. Designed for the 65mm format, they provide a depth of field and field of view that is impossible to replicate."
  },
  {
    id: '3',
    slug: 'millennium-dxl2',
    name: 'Millennium DXL2',
    category: 'camera',
    featured: true,
    tagline: '8K Large Format Camera System.',
    specs: {
      tStop: 'N/A',
      closeFocus: 'N/A',
      frontDiameter: 'N/A',
      weight: '4.5 kg',
      coverage: ['Large Format', 'Full Frame', 'Super 35'],
      mount: ['PV', 'PL', 'LPL'],
    },
    media: {
      heroImage: 'https://images.unsplash.com/photo-1550948537-130a1ce83314?q=80&w=2900&auto=format&fit=crop',
      gallery: ['https://images.unsplash.com/photo-1550948537-130a1ce83314?q=80&w=800&auto=format&fit=crop']
    },
    description: "The Millennium DXL2 8K camera features a Monstro 8K VV sensor, offering 16 stops of dynamic range and native ISO of 1600. It seamlessly integrates into the Thabangvision ecosystem."
  }
];

export const proprietaryTech = [
  {
    id: 'tech-01',
    title: 'AI Optical Calibration',
    description: 'Proprietary distortion mapping and breathing compensation engine for anamorphic glass analysis.',
    image: 'https://images.unsplash.com/photo-1589578228447-e1a4e481c6c8?q=80&w=2000&auto=format&fit=crop',
    toolId: 'lens_compare',
    toolLabel: 'Analyze Lenses'
  },
  {
    id: 'tech-02',
    title: 'Resilient Power AI',
    description: 'Predictive load balancing and generator sizing algorithms optimized for local power grid instability.',
    image: 'https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?q=80&w=2000&auto=format&fit=crop',
    toolId: 'power',
    toolLabel: 'Calculate Load'
  },
  {
    id: 'tech-03',
    title: 'Data Workflow Engine',
    description: 'Automated storage calculation and bandwidth optimization pipeline for 8K+ RAW workflows.',
    image: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?q=80&w=2000&auto=format&fit=crop',
    toolId: 'storage',
    toolLabel: 'Optimize Data'
  },
  {
    id: 'tech-04',
    title: 'Virtual Scout',
    description: 'Digital twin location analysis with integrated sun path, weather data, and permit requirements.',
    image: 'https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?q=80&w=2000&auto=format&fit=crop',
    toolId: 'location',
    toolLabel: 'Launch Scout'
  },
  {
    id: 'tech-05',
    title: 'Pre-Vis Optics',
    description: 'Simulate sensor coverage and field of view for complex multi-camera setups in real-time.',
    image: 'https://images.unsplash.com/photo-1533575928286-336c91e56997?q=80&w=2000&auto=format&fit=crop',
    toolId: 'fov',
    toolLabel: 'Simulate FOV'
  },
  {
    id: 'tech-06',
    title: 'Production Neural Net',
    description: 'Real-time production cost estimation and resource allocation based on live market rates.',
    image: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?q=80&w=2000&auto=format&fit=crop',
    toolId: 'budget',
    toolLabel: 'Estimate Budget'
  }
];

export const capabilities = [
  {
    title: 'Smart Productions',
    subtitle: 'Creative Services Hub',
    image: 'https://images.unsplash.com/photo-1549488497-293d077468eb?q=80&w=2900&auto=format&fit=crop',
    link: '/smart-production'
  },
  {
    title: 'Smart Rentals',
    subtitle: 'AI-Optimized Gear',
    image: 'https://images.unsplash.com/photo-1550948537-130a1ce83314?q=80&w=2900&auto=format&fit=crop',
    link: '/smart-rentals'
  },
  {
    title: 'Ubunye AI Studio',
    subtitle: 'AI Tools, Automation & Creative Intelligence',
    image: 'https://images.unsplash.com/photo-1535016120720-40c6874c3b1c?q=80&w=2900&auto=format&fit=crop',
    link: '/ubunye-ai-studio'
  },
  {
    title: 'Marketplace',
    subtitle: 'Buy, Sell & Trade Creative Gear',
    image: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?q=80&w=2900&auto=format&fit=crop',
    link: '/marketplace'
  },
  {
    title: 'Creator Dashboard',
    subtitle: 'Manage Your Studio',
    image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=2900&auto=format&fit=crop',
    link: '/dashboard'
  }
];

export const rentalCategories = [
  {
    slug: 'cameras-optics',
    title: 'Cameras & Optics',
    subtitle: 'High-end Cinema Systems',
    image: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?q=80&w=2800&auto=format&fit=crop',
    description: 'Covers cameras and lenses (high-end cinema cameras, primes, zooms, anamorphics, etc.)'
  },
  {
    slug: 'lighting-power',
    title: 'Lighting & Power',
    subtitle: 'Fixtures & Distribution',
    image: 'https://images.unsplash.com/photo-1524253482453-3fed8d2fe12b?q=80&w=2800&auto=format&fit=crop',
    description: 'Combines lighting fixtures with energy/power solutions (LEDs, HMIs, generators, distribution, batteries)'
  },
  {
    slug: 'audio',
    title: 'Audio',
    subtitle: 'Capture & Monitoring',
    image: 'https://images.unsplash.com/photo-1590845947698-8924d7409b56?q=80&w=2800&auto=format&fit=crop',
    description: 'Dedicated to microphones, mixers, recorders, wireless systems, monitoring'
  },
  {
    slug: 'grip-motion',
    title: 'Grip & Motion',
    subtitle: 'Support & Stabilization',
    image: 'https://images.unsplash.com/photo-1601506521793-dc748fc80b67?q=80&w=2800&auto=format&fit=crop',
    description: 'Dollies, cranes, stabilizers, remote heads'
  },
  {
    slug: 'crew-services',
    title: 'Crew Services',
    subtitle: 'Technical Personnel',
    image: 'https://images.unsplash.com/photo-1605379399642-870262d3d051?q=80&w=2900&auto=format&fit=crop',
    description: 'For "hire a team" (DPs, gaffers, sound ops, grips, DITs, full crew packages)'
  },
  {
    slug: 'data-storage',
    title: 'Data & Storage',
    subtitle: 'Media Management',
    image: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?q=80&w=2800&auto=format&fit=crop',
    description: 'Drives, RAID systems, on-set carts, cloud backup solutions, media management'
  },
  {
    slug: 'specialized',
    title: 'Specialized Solutions',
    subtitle: 'Emerging Tech & VP',
    image: 'https://images.unsplash.com/photo-1617581629397-a72507c3de9e?q=80&w=2800&auto=format&fit=crop',
    description: 'For emerging tech: VR/AR rigs, LED walls, virtual production tools, drones, etc.'
  }
];

export const projects: Project[] = [
  // FILM PROJECTS
  {
    id: 'f-01',
    slug: 'neon-horizon',
    title: 'Neon Horizon',
    client: 'Warner Bros.',
    year: '2025',
    type: 'film',
    subCategory: 'Narrative',
    thumbnail: 'https://images.unsplash.com/photo-1549488497-293d077468eb?q=80&w=2900&auto=format&fit=crop',
    tags: ['Anamorphic', 'Virtual Production'],
    videoId: 'M7fi_IBsaNc',
    description: 'A cyberpunk noir exploring the intersection of memory and data. Shot on System 65 with custom-tuned expansion optics to create a distinct flaring profile that reacts to the LED volume light sources.',
    credits: [
      { role: 'Director', name: 'Elena K' },
      { role: 'DoP', name: 'Marcus V' },
      { role: 'Colorist', name: 'Company 3' }
    ]
  },
  {
    id: 'f-02',
    slug: 'apex-speed',
    title: 'Apex Speed',
    client: 'Porsche',
    year: '2025',
    type: 'film',
    subCategory: 'Commercial',
    thumbnail: 'https://images.unsplash.com/photo-1503376763036-066120622c74?q=80&w=2900&auto=format&fit=crop',
    tags: ['High Speed', 'Stabilization'],
    videoId: 'M7fi_IBsaNc',
    description: 'High-octane commercial spot featuring the new GT3 RS. Utilized custom hard-mount rigging on the pursuit arm to maintain horizon stability at 240km/h.',
  },
  {
    id: 'f-03',
    slug: 'the-silent-sea',
    title: 'The Silent Sea',
    client: 'A24',
    year: '2024',
    type: 'film',
    subCategory: 'Narrative',
    thumbnail: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2900&auto=format&fit=crop',
    tags: ['Underwater', 'Large Format'],
    videoId: 'M7fi_IBsaNc',
    description: 'Atmospheric thriller set in a deep-sea research station. Thabangvision engineered a bespoke underwater housing for the DXL2 to allow for lens changes without surfacing.',
  },

  // PHOTOGRAPHY PROJECTS
  {
    id: 'p-01',
    slug: 'urban-portraits',
    title: 'Faces of Jozi',
    type: 'photography',
    subCategory: 'Portrait',
    thumbnail: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=2000&auto=format&fit=crop',
    tags: ['Portrait', 'Street'],
    gallery: [
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=2000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?q=80&w=2000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=2000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=2000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=2000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?q=80&w=2000&auto=format&fit=crop'
    ]
  },
  {
    id: 'p-02',
    slug: 'industrial-light',
    title: 'Industrial Light',
    type: 'photography',
    subCategory: 'Printouts',
    thumbnail: 'https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=2000&auto=format&fit=crop',
    tags: ['Architecture', 'Abstract'],
    gallery: [
      'https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=2000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=2000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=2000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1479839672679-a46483c0e7c8?q=80&w=2000&auto=format&fit=crop'
    ]
  },
  {
    id: 'p-03',
    slug: 'night-events',
    title: 'Nocturnal',
    type: 'photography',
    subCategory: 'Events',
    thumbnail: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=2000&auto=format&fit=crop',
    tags: ['Event', 'Nightlife'],
    gallery: [
      'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=2000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1514525253440-b393452e8d26?q=80&w=2000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?q=80&w=2000&auto=format&fit=crop'
    ]
  }
];

// ─── CAREERS ────────────────────────────────────────────────────────────────

export type Career = {
  id: string;
  title: string;
  department: string;
  location: string;
  description: string;
  isPublished: boolean;
  createdAt: string;
};

export let careers: Career[] = [
  {
    id: 'c-01',
    title: 'Senior Optical Engineer',
    department: 'The Lab / Engineering',
    location: 'Johannesburg, ZA',
    description: 'Lead the design of proprietary anamorphic elements and custom coating formulations for our next-generation lens series.',
    isPublished: true,
    createdAt: '2025-10-01',
  },
  {
    id: 'c-02',
    title: 'Virtual Production Specialist',
    department: 'Smart Productions',
    location: 'Johannesburg, ZA',
    description: 'Manage the LED volume pipeline, ensuring real-time Unreal Engine assets sync perfectly with camera tracking data.',
    isPublished: true,
    createdAt: '2025-10-15',
  },
];

// ─── PRESS ──────────────────────────────────────────────────────────────────

export type PressArticle = {
  id: string;
  title: string;
  slug: string;
  content: string;
  coverImage?: string;
  publishedAt: string;
  isPublished: boolean;
};

export let press: PressArticle[] = [
  {
    id: 'pa-01',
    title: 'Thabangvision Unveils "Apex" Anamorphic Series at IBC',
    slug: 'apex-anamorphic-ibc',
    content: 'The new lens series features a 1.8x squeeze ratio and proprietary coating technology developed in the Joburg Lab.',
    coverImage: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?q=80&w=2900&auto=format&fit=crop',
    publishedAt: '2025-10-12',
    isPublished: true,
  },
  {
    id: 'pa-02',
    title: 'Expansion into Virtual Production: The New Stage 4',
    slug: 'virtual-production-stage-4',
    content: 'A 500sqm LED volume dedicated to car commercials and music videos opens in Maboneng.',
    coverImage: 'https://images.unsplash.com/photo-1535016120720-40c6874c3b1c?q=80&w=2900&auto=format&fit=crop',
    publishedAt: '2025-09-04',
    isPublished: true,
  },
];

// ─── RENTAL CATALOG ──────────────────────────────────────────────────────────

export const rentalCatalog: RentalProduct[] = [
  // Cameras
  {
    id: 'r-01',
    name: 'ALEXA 35',
    brand: 'ARRI',
    categorySlug: 'cameras-optics',
    type: 'Cinema Camera',
    image: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?q=80&w=800&auto=format&fit=crop',
    specs: ['Super 35', '4.6K', '120fps', 'LPL Mount'],
    dailyRate: 14500,
    weeklyRate: 43500,
    inStock: true,
    isNew: true
  },
  {
    id: 'r-02',
    name: 'VENICE 2 8K',
    brand: 'SONY',
    categorySlug: 'cameras-optics',
    type: 'Cinema Camera',
    image: 'https://images.unsplash.com/photo-1550948537-130a1ce83314?q=80&w=800&auto=format&fit=crop',
    specs: ['Full Frame', '8.6K', '16 Stops', 'PL Mount'],
    dailyRate: 13000,
    weeklyRate: 39000,
    inStock: true,
    isNew: true
  },
  {
    id: 'r-03',
    name: 'V-RAPTOR XL',
    brand: 'RED',
    categorySlug: 'cameras-optics',
    type: 'Cinema Camera',
    image: 'https://images.unsplash.com/photo-1589873979407-1b3a88701049?q=80&w=800&auto=format&fit=crop',
    specs: ['Multi-Format', '8K', 'High Speed', 'PL Mount'],
    dailyRate: 9500,
    weeklyRate: 28500,
    inStock: false,
    isNew: false
  },
  // Lenses
  {
    id: 'r-04',
    name: 'Cooke S7/i Full Frame',
    brand: 'COOKE',
    categorySlug: 'cameras-optics',
    type: 'Prime Lens Set',
    image: 'https://images.unsplash.com/photo-1626847037657-fd3622613ce3?q=80&w=800&auto=format&fit=crop',
    specs: ['T2.0', '7 Lens Set', 'Full Frame Plus'],
    dailyRate: 18000,
    weeklyRate: 54000,
    inStock: true,
    isNew: false
  },
  {
    id: 'r-05',
    name: 'Master Anamorphic',
    brand: 'ARRI',
    categorySlug: 'cameras-optics',
    type: 'Anamorphic Lens',
    image: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?q=80&w=800&auto=format&fit=crop',
    specs: ['T1.9', '35mm', '2.0x Squeeze'],
    dailyRate: 3500,
    weeklyRate: 10500,
    inStock: true,
    isNew: false
  },
  // Lighting
  {
    id: 'r-06',
    name: 'SkyPanel X',
    brand: 'ARRI',
    categorySlug: 'lighting-power',
    type: 'LED Fixture',
    image: 'https://images.unsplash.com/photo-1563319768-e3660d84c0c1?q=80&w=800&auto=format&fit=crop',
    specs: ['Modular', 'IP66', 'RGBACL'],
    dailyRate: 5500,
    weeklyRate: 16500,
    inStock: true,
    isNew: true
  },
  {
    id: 'r-07',
    name: 'Vortex8',
    brand: 'CREAMSOURCE',
    categorySlug: 'lighting-power',
    type: 'LED Fixture',
    image: 'https://images.unsplash.com/photo-1524253482453-3fed8d2fe12b?q=80&w=800&auto=format&fit=crop',
    specs: ['650W', 'IP65', 'High Output'],
    dailyRate: 2800,
    weeklyRate: 8400,
    inStock: false,
    isNew: false
  },
  // Grip
  {
    id: 'r-08',
    name: 'Technocrane 22',
    brand: 'SUPERTECHNO',
    categorySlug: 'grip-motion',
    type: 'Telescopic Crane',
    image: 'https://images.unsplash.com/photo-1601506521793-dc748fc80b67?q=80&w=800&auto=format&fit=crop',
    specs: ['6.7m Reach', 'Telescoping', 'Mobile Base'],
    dailyRate: 15000,
    weeklyRate: 45000,
    inStock: true,
    isNew: false
  }
];
