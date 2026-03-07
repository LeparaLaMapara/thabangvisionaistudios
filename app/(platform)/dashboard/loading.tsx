import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function DashboardLoading() {
  return (
    <div className="flex items-center justify-center py-20">
      <LoadingSpinner size="lg" label="Loading dashboard" />
    </div>
  );
}
