'use client';

import { ThemeProvider } from 'next-themes';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"       // Writes .dark/.light class on <html>
      defaultTheme="dark"     // Matches className="dark" hardcoded on <html>
      enableSystem={false}    // Studio always defaults dark; ignore OS preference
      disableTransitionOnChange={false}
    >
      {children}
    </ThemeProvider>
  );
}
