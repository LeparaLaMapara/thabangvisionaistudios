import { buildPageMetadata } from '@/lib/seo/metadata';

// A form for signed-in users; not a search landing page.
export const metadata = buildPageMetadata({
  title: 'Report a Bug',
  description: 'Tell us about something that is not working.',
  path: '/support/report-bug',
  noIndex: true,
});

export default function ReportBugLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
