'use client';

import { MotionConfig } from 'framer-motion';
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
    // reducedMotion="user": every framer-motion animation follows the phone's
    // "reduce motion" setting (slides and zooms become simple fades).
    <MotionConfig reducedMotion="user">
      <AuthProvider initialUser={initialUser}>
        <CartProvider>
          {children}
        </CartProvider>
      </AuthProvider>
    </MotionConfig>
  );
}
