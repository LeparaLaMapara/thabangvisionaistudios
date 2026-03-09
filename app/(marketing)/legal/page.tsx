import type { Metadata } from 'next';
import { STUDIO } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    `${STUDIO.shortName} Terms of Service — rental agreements, intellectual property, and governing law.`,
};

export default function LegalPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-32 pb-20 transition-colors duration-500">
      <div className="container mx-auto px-6 max-w-4xl">
        <h1 className="text-4xl md:text-6xl font-display font-medium text-black dark:text-white uppercase mb-12">
          Terms of Service
        </h1>

        <div className="prose prose-lg dark:prose-invert font-light text-neutral-600 dark:text-neutral-400 max-w-none">
          <p className="lead text-xl">Last Updated: October 2024</p>

          <h3>1. Acceptance of Terms</h3>
          <p>By accessing and using the {STUDIO.shortName} website and services, including our rental and production tools, you agree to comply with and be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.</p>

          <h3>2. Rental Agreement</h3>
          <p>All equipment rentals are subject to our standard Rental Agreement, which must be signed prior to the release of any gear. This agreement covers insurance requirements, liability for damage, and return protocols.</p>

          <h3>3. Intellectual Property</h3>
          <p>All content on this site, including but not limited to text, graphics, logos, images, and software, is the property of {STUDIO.shortName} or its content suppliers and protected by international copyright laws. The &ldquo;{STUDIO.shortName}&rdquo; name and logo are trademarks of {STUDIO.legal.tradingAs}.</p>

          <h3>4. Use of Digital Tools</h3>
          <p>The calculators and estimators provided on this site are for estimation purposes only. Actual production costs and technical specifications may vary based on real-world conditions. {STUDIO.shortName} assumes no liability for errors in production planning based on these tools.</p>

          <h3>5. Limitation of Liability</h3>
          <p>{STUDIO.shortName} shall not be liable for any direct, indirect, incidental, special, or consequential damages resulting from the use or inability to use our services or website.</p>

          <h3>6. Governing Law</h3>
          <p>These terms shall be governed by and construed in accordance with the laws of South Africa. Any disputes arising under these terms shall be subject to the exclusive jurisdiction of the courts located in {STUDIO.location.city}.</p>
        </div>
      </div>
    </div>
  );
}
