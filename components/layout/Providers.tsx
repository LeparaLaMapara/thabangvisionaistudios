'use client';

import { ThemeProvider } from 'next-themes';
import { AuthProvider } from '@/providers/AuthProvider';

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
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      forcedTheme="dark"
      enableSystem={false}
      disableTransitionOnChange={false}
    >
      <AuthProvider initialUser={initialUser}>
        {children}
      </AuthProvider>
    </ThemeProvider>
  );
}
