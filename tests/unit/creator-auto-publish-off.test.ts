import { describe, it, expect, vi } from 'vitest';

// The daily job used to publish every unpublished creator production older
// than 7 days, including pages an admin hid on purpose with the publish
// toggle on /admin/projects: nothing records that decision. It is switched
// off until an admin decision is stored.

const from = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from }), createClient: async () => ({ from }) }));

const { AUTO_PUBLISH_CREATOR_PRODUCTIONS, autoPublishCreatorProductions } = await import('@/lib/supabase/queries/smartProductions');

describe('creator production auto-publish', () => {
  it('is switched off', () => {
    expect(AUTO_PUBLISH_CREATOR_PRODUCTIONS).toBe(false);
  });

  it('publishes nothing and does not touch the database', async () => {
    expect(await autoPublishCreatorProductions()).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });
});
