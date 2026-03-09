import type { Metadata } from 'next';
import { STUDIO } from '@/lib/constants';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-32 pb-20 transition-colors duration-500">
       <div className="container mx-auto px-6 max-w-4xl">
          <h1 className="text-4xl md:text-6xl font-display font-medium text-black dark:text-white uppercase mb-12">Privacy Policy</h1>

          <div className="prose prose-lg dark:prose-invert font-light text-neutral-600 dark:text-neutral-400 max-w-none">
             <p className="lead text-xl">Last Updated: October 2024</p>

             <h3>1. Information We Collect</h3>
             <p>We collect information you provide directly to us, such as when you fill out a contact form, request a quote, or sign up for our newsletter. This may include your name, email address, phone number, and company details.</p>

             <h3>2. How We Use Your Information</h3>
             <p>We use the information we collect to:</p>
             <ul>
               <li>Provide, maintain, and improve our services.</li>
               <li>Process rental requests and production bookings.</li>
               <li>Send you technical updates, newsletters, and marketing communications (which you can opt out of at any time).</li>
               <li>Respond to your comments and questions.</li>
             </ul>

             <h3>3. Data Security</h3>
             <p>We implement appropriate technical and organizational measures to protect the security of your personal information. However, please note that no method of transmission over the Internet is 100% secure.</p>

             <h3>4. Cookies and Tracking</h3>
             <p>We use cookies to analyze website traffic and improve your browsing experience. You can instruct your browser to refuse all cookies or to indicate when a cookie is being sent.</p>

             <h3>5. Third-Party Disclosure</h3>
             <p>We do not sell, trade, or otherwise transfer your Personally Identifiable Information to outside parties, except for trusted third parties who assist us in operating our website or conducting our business, so long as those parties agree to keep this information confidential.</p>

             <h3>6. Contact Us</h3>
             <p>If you have any questions about this Privacy Policy, please contact us at {STUDIO.privacyEmail}.</p>
          </div>
       </div>
    </div>
  );
}
