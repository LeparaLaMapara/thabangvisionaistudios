export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { EARN, ROLES_POLICY } from '@/lib/constants';
import { getFlag } from '@/lib/features';
import { buildPageMetadata } from '@/lib/seo/metadata';

export const metadata = buildPageMetadata({ title: 'What we look for', description: EARN.copy, path: '/offer/guidelines', noIndex: true });

/** The one "What we look for" link the person sees. The detailed review guidelines are for reviewers. */
export default async function WhatWeLookFor() {
  if (!(await getFlag('roles_v1'))) notFound();
  const points = [
    'Your real work, shown clearly. Good light helps.',
    'Photos of the work, not of you. Make-up shows the face you did. Models are the one exception: how you look is the work.',
    'Your own photo, so we know who is coming. Clients see it only after they book you.',
    'Where the law asks for a document (a driving licence, a licence disc, an ID for models), one clear photo of it.',
    'A fair price. We suggest one.',
  ];
  return (
    <div className="pt-28 pb-16 px-4">
      <div className="max-w-lg mx-auto">
        <Link href="/offer" className="inline-flex items-center gap-2 min-h-[44px] text-sm text-neutral-400 hover:text-white mb-4"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back</Link>
        <h1 className="text-3xl font-display font-medium text-white mb-6">What we look for</h1>
        <ul className="space-y-3 text-neutral-200">{points.map((p) => <li key={p} className="border-l-2 border-accent-gold pl-3">{p}</li>)}</ul>
        <p className="mt-6 text-sm text-neutral-400">{ROLES_POLICY.copy.reviewPromise}</p>
      </div>
    </div>
  );
}
