import { Header } from '@/components/layout/Header';

/**
 * Immersive layout — Header only, no Footer.
 * Used for full-viewport experiences like Ubunye AI Studio.
 */
export default function ImmersiveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen bg-[#030305] text-white">
      <Header />
      <main className="flex-grow">
        {children}
      </main>
    </div>
  );
}
