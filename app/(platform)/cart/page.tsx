import { redirect } from 'next/navigation';

/** The cart lives in the dashboard; /cart used to be a 404. */
export default function CartRedirect(): never {
  redirect('/dashboard/cart');
}
