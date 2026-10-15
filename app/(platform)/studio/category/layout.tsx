import { permanentRedirect } from 'next/navigation';
import { getFlag } from '@/lib/features';

/**
 * People (roles_v1): one way to book a person, the People profile. Every old
 * category, creator and city page under /studio/category answers 308 to
 * /people, so nobody meets a second price or a second way to book.
 */
export default async function StudioCategoryLayout({ children }: { children: React.ReactNode }) {
  if (await getFlag('roles_v1')) permanentRedirect('/people');
  return <>{children}</>;
}
