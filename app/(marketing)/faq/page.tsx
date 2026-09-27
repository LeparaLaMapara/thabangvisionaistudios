export const revalidate = 60;

import Link from 'next/link';
import { getPublishedFaqs } from '@/lib/supabase/queries/chatFaqs';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { faqPageJsonLd, breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import { STUDIO } from '@/lib/constants';
import { coreFaqs } from '@/lib/content/faqs';

export const metadata = buildPageMetadata({
  title: 'Frequently Asked Questions',
  description: `Answers about ${STUDIO.shortName}: renting gear, booking photographers, prices and VAT, deposits, delivery, the ID check and cancelling.`,
  path: '/faq',
});

const FAQ_CATEGORIES: Record<string, string> = {
  booking: 'Booking & Scheduling',
  pricing: 'Pricing & Payments',
  equipment: 'Equipment Rentals',
  creators: 'Creators & Professionals',
  platform: 'Platform & Account',
  general: 'General',
};

export default async function FaqPage() {
  // The core answers come from the same settings checkout uses; published
  // FAQs from /admin/faqs follow them.
  const published = await getPublishedFaqs(100);
  const faqs: { id: string; category: string | null; question: string; answer: string }[] = [
    ...coreFaqs(),
    ...published.map((f) => ({ id: f.id, category: f.category, question: f.question, answer: f.answer })),
  ];

  const grouped = faqs.reduce<Record<string, typeof faqs>>((acc, faq) => {
    const cat = faq.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(faq);
    return acc;
  }, {});

  const allQA = faqs.map((f) => ({ question: f.question, answer: f.answer }));

  const jsonLd = [
    faqPageJsonLd(allQA),
    breadcrumbJsonLd([
      { name: 'Home', url: STUDIO.meta.url },
      { name: 'FAQ', url: `${STUDIO.meta.url}/faq` },
    ]),
  ];

  return (
    <>
      {jsonLd.map((ld, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: renderJsonLd(ld) }}
        />
      ))}

      <div className="min-h-screen bg-white dark:bg-[#050505] pt-32 pb-20 transition-colors duration-500">
        <div className="container mx-auto px-6 max-w-3xl">
          <div className="mb-16">
            <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
              FAQ
            </p>
            <h1 className="text-4xl md:text-6xl font-display font-medium uppercase tracking-tight text-black dark:text-white mb-4">
              Frequently Asked Questions
            </h1>
            <p className="text-neutral-500 font-light max-w-xl text-sm md:text-base leading-relaxed">
              Can&apos;t find what you&apos;re looking for?{' '}
              <Link href="/ubunye-ai-studio" className="text-[#D4A843] hover:underline">
                Ask Ubunye AI
              </Link>{' '}
              or{' '}
              <Link href="/contact" className="text-[#D4A843] hover:underline">
                contact us
              </Link>
              .
            </p>
          </div>

          {Object.keys(grouped).length === 0 ? (
            <div className="py-20 text-center border border-black/5 dark:border-white/5">
              <p className="text-neutral-500 font-mono text-sm mb-4">
                No FAQs published yet.
              </p>
              <Link
                href="/ubunye-ai-studio"
                className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-[#D4A843] hover:underline"
              >
                Ask Ubunye AI instead
              </Link>
            </div>
          ) : (
            <div className="space-y-16">
              {Object.entries(grouped).map(([cat, items]) => (
                <section key={cat}>
                  <h2 className="text-xs font-mono uppercase tracking-widest text-neutral-500 mb-6 pb-3 border-b border-black/10 dark:border-white/10">
                    {FAQ_CATEGORIES[cat] ?? cat}
                  </h2>
                  <div className="space-y-8">
                    {items.map((faq) => (
                      <div key={faq.id}>
                        <h3 className="text-base font-display font-medium text-black dark:text-white mb-2">
                          {faq.question}
                        </h3>
                        <p className="text-sm text-neutral-600 dark:text-neutral-400 font-light leading-relaxed">
                          {faq.answer}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
