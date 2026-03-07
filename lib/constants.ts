
export const SITE_NAME = 'THABANGVISION';
export const SITE_SUFFIX = '.LAB';
export const SITE_TAGLINE = 'Technology Creative Studio';
export const SITE_COPYRIGHT = `© ${new Date().getFullYear()} THABANGVISION. ALL RIGHTS RESERVED.`;

// CONFIGURATION FLAGS
export const SHOW_CAREERS = true; // Set to false to hide Careers page and links

export const MAIN_NAVIGATION = [
  {
    label: 'The Lab',
    href: '/lab',
    children: [
      { label: 'About', href: '/lab' },
      { label: 'Our Team', href: '/careers' },
    ]
  },
  {
    label: 'Capabilities',
    href: '/smart-production',
    children: [
      { label: 'Smart Productions', href: '/smart-production' },
      { label: 'Smart Rentals', href: '/smart-rentals' },
      {
        label: 'Ubunye AI Studio',
        href: '/ubunye-ai-studio',
        children: [
          { label: 'Virtual Production', href: '/ubunye-ai-studio#vp' },
          { label: 'Remote Systems', href: '/ubunye-ai-studio#remote' },
          { label: 'Lighting Science', href: '/ubunye-ai-studio#lighting' },
          { label: 'Data & Workflow', href: '/ubunye-ai-studio#data' },
          { label: 'Creative AI Labs', href: '/ubunye-ai-studio#labs' },
        ]
      },
    ]
  },
  {
    label: 'Tools',
    href: '/resources/tools',
    children: [
      { label: 'Optics Calculators', href: '/resources/tools' },
      { label: 'Production Planners', href: '/resources/tools' },
      { label: 'Lens Comparison', href: '/resources/tools' },
    ]
  },
  {
    label: 'Pricing',
    href: '/pricing',
  },
  {
    label: 'Contact',
    href: '/contact',
  }
];

export const FOOTER_SECTIONS = [
  {
    title: 'Thabangvision Global',
    links: [
      { label: 'Locations', href: '/locations' },
      { label: 'The Lab', href: '/lab' },
      ...(SHOW_CAREERS ? [{ label: 'Careers', href: '/careers' }] : []),
      { label: 'Press & News', href: '/press' },
    ]
  },
  {
    title: 'Account',
    links: [
      { label: 'Sign In', href: '/login' },
      { label: 'Create Account', href: '/register' },
      { label: 'Dashboard', href: '/dashboard' },
    ]
  },
  {
    title: 'Support',
    links: [
      { label: 'Contact', href: '/contact' },
      { label: 'Technical Support', href: '/support/tech' },
      { label: 'Legal / Terms', href: '/legal' },
      { label: 'Privacy Policy', href: '/privacy' },
    ]
  }
];

export const SOCIAL_LINKS = [
  { platform: 'Youtube', href: 'https://youtube.com/@thabangvisionai' },
  { platform: 'Instagram', href: 'https://instagram.com/thabangvisionai' },
  { platform: 'Facebook', href: 'https://facebook.com/thabangvisionai' },
  { platform: 'Twitter', href: 'https://x.com/thabangvisionai' },
  { platform: 'Linkedin', href: 'https://linkedin.com/company/thabangvisionai' },
  { platform: 'Mail', href: 'mailto:studio@thabangvision.com' },
];
