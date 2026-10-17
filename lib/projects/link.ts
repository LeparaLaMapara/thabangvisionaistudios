import { addItem } from '@/lib/core/projects/use-cases';
import { isUuid } from '@/lib/core/projects/plan';
import { SupabaseProjectStore } from './store';

/**
 * A People request sent from a plan (the request link carried ?plan=&need=)
 * joins that plan. The plan service checks the flag, that the plan is the
 * client's open plan and that the request is theirs; the database checks
 * again. Never fails the request itself: null when no plan was asked for,
 * otherwise whether it was added.
 */
export async function linkRequestToPlan(clientId: string, planId: unknown, requestId: string, needItemId: unknown): Promise<boolean | null> {
  if (!isUuid(planId)) return null;
  try {
    const out = await addItem(new SupabaseProjectStore(), { clientId, projectId: planId, kind: 'people_request', refId: requestId, replacesNeedId: needItemId });
    if (!out.ok) console.warn('[plans] request not added to plan:', out.code);
    return out.ok;
  } catch {
    console.error('[plans] request link failed');
    return false;
  }
}
