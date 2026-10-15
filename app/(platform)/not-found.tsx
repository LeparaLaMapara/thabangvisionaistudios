import { NotFoundMessage, notFoundMetadata } from '@/components/layout/NotFoundMessage';

export const metadata = notFoundMetadata;

/**
 * "Not found" inside the site: the header and footer come from this section's
 * layout, so this is only the message. (app/not-found.tsx, for addresses that
 * match no page at all, brings its own header and footer.)
 */
export default function NotFound() {
  return <NotFoundMessage />;
}
