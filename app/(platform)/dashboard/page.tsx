import { createClient } from '@/lib/supabase/server';
import { getProfileById } from '@/lib/supabase/queries/profiles';

export const metadata = {
  title: 'Dashboard',
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = user ? await getProfileById(user.id) : null;

  return (
    <div>
      <h2 className="text-lg font-display font-medium uppercase text-black dark:text-white mb-6">
        Welcome{profile?.display_name ? `, ${profile.display_name}` : ''}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <StatCard label="Bookings" value="0" />
        <StatCard label="Listings" value="0" />
        <StatCard label="Orders" value="0" />
      </div>

      <div className="bg-neutral-100 dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 p-8 text-center">
        <p className="text-sm text-neutral-500 font-mono">
          Your activity and recent transactions will appear here.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-100 dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 p-6">
      <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
        {label}
      </p>
      <p className="text-2xl font-display font-medium text-black dark:text-white">
        {value}
      </p>
    </div>
  );
}
