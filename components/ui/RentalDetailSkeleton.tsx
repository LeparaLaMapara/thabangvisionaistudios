import { Skeleton } from './Skeleton';

export function RentalDetailSkeleton() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-20">
      {/* Breadcrumb skeleton */}
      <div className="bg-neutral-50 dark:bg-[#080808] border-b border-black/5 dark:border-white/5 py-6">
        <div className="container mx-auto px-6">
          <Skeleton className="h-3 w-64" />
        </div>
      </div>

      {/* Hero skeleton */}
      <div className="relative h-[60vh] md:h-[70vh] w-full overflow-hidden bg-neutral-100 dark:bg-neutral-900">
        <Skeleton className="w-full h-full rounded-none" />
        {/* Staggered text reveals skeleton at bottom */}
        <div className="absolute bottom-0 left-0 w-full z-20 pb-16 pt-32 bg-gradient-to-t from-white to-transparent dark:from-[#050505] dark:to-transparent">
          <div className="container mx-auto px-6 space-y-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-12 w-96 max-w-full" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-full max-w-2xl" />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-12">
        <div className="grid lg:grid-cols-[1fr_420px] gap-12 xl:gap-20 items-start">
          {/* Left: Gallery placeholder */}
          <div>
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            {/* Thumbnail strip */}
            <div className="flex gap-2 mt-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="w-20 h-20 flex-shrink-0 rounded-none" />
              ))}
            </div>
            {/* Specs skeleton */}
            <div className="mt-12 pt-12 border-t border-black/5 dark:border-white/5">
              <Skeleton className="h-6 w-52 mb-8" />
              <div className="grid grid-cols-2 gap-px">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="p-4 space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Product info */}
          <div className="space-y-6">
            {/* Featured badge */}
            <Skeleton className="h-5 w-20" />
            {/* Price box */}
            <div className="border border-black/10 dark:border-white/10 p-5 space-y-3">
              <div className="flex justify-between items-end">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-7 w-28" />
              </div>
              <div className="flex justify-between items-end pt-3 border-t border-black/5 dark:border-white/5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-24" />
              </div>
            </div>
            {/* Tab headers */}
            <div className="flex gap-4 border-b border-black/10 dark:border-white/10 pb-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-20" />
            </div>
            {/* Feature list */}
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="w-3.5 h-3.5 rounded-full flex-shrink-0" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
            {/* Tags */}
            <div className="flex gap-1.5 pt-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-16 rounded-none" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
