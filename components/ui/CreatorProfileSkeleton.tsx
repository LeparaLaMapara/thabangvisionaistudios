import { Skeleton } from './Skeleton';

export function CreatorProfileSkeleton() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0A0B] pt-20">
      {/* Cover banner skeleton */}
      <div className="relative h-48 md:h-64">
        <Skeleton className="w-full h-full rounded-none" />
      </div>

      <div className="container mx-auto px-6 pb-32">
        <div className="max-w-3xl mx-auto">
          {/* Avatar + Info */}
          <div className="flex flex-col sm:flex-row items-start gap-8 -mt-16 relative z-10 mb-16">
            <Skeleton className="w-28 h-28 rounded-full flex-shrink-0 ring-4 ring-white dark:ring-[#0A0A0B]" />
            <div className="flex-1 space-y-3 pt-4 sm:pt-8">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full max-w-xl" />
              <Skeleton className="h-3 w-4/5 max-w-xl" />
            </div>
          </div>

          {/* Skills */}
          <div className="mb-16">
            <Skeleton className="h-4 w-20 mb-6" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-20" />
              ))}
            </div>
          </div>

          {/* Portfolio grid */}
          <div className="mb-16">
            <Skeleton className="h-4 w-28 mb-6" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[3/2] w-full rounded-none" />
              ))}
            </div>
          </div>

          {/* Reviews */}
          <div className="mb-16">
            <Skeleton className="h-4 w-24 mb-6" />
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="border border-black/5 dark:border-white/5 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="w-8 h-8 rounded-full" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
