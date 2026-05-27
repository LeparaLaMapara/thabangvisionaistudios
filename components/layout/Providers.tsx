'use client';

import { AuthProvider } from '@/providers/AuthProvider';
import { CartProvider } from '@/providers/CartProvider';

type SerializedUser = {
  id: string;
  email?: string;
} | null;

export function Providers({
  initialUser,
  children,
}: {
  initialUser: SerializedUser;
  children: React.ReactNode;
}) {
  return (
    <AuthProvider initialUser={initialUser}>
      <CartProvider>
        {children}
      </CartProvider>
    </AuthProvider>
  );
}
