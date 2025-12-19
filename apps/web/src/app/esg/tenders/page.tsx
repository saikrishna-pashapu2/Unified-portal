import { Suspense } from 'react';
import TendersList from '@/components/tenders/TendersList';
import TendersFilters from '@/components/tenders/TendersFilters';
import { Skeleton } from '@/components/ui/skeleton';

export const revalidate = 300; // Revalidate every 5 minutes


export default async function TendersPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const domain = 'esg';
  const page = searchParams.page ? parseInt(searchParams.page as string) : 1;
  const search = searchParams.search as string | undefined;
  const status = searchParams.status as string | undefined;
  const minAmount = searchParams.minAmount as string | undefined;
  const maxAmount = searchParams.maxAmount as string | undefined;

  const title = 'ESG Tenders';
  const description = 'Browse government tenders related to ESG, sustainability, and environmental projects.';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-to-b from-primary/5 to-transparent border-b border-border">
        <div className="mx-auto max-w-[1400px] px-6 py-12">
          <h1 className="text-4xl font-bold text-foreground mb-3">
            {title}
          </h1>
          <p className="text-lg text-muted-foreground max-w-3xl">
            {description}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Filters Sidebar */}
          <aside className="lg:col-span-1">
            <div className="sticky top-24">
              <Suspense fallback={<FiltersSkeleton />}>
                <TendersFilters 
                  domain={domain}
                  currentSearch={search}
                  currentStatus={status}
                  currentMinAmount={minAmount}
                  currentMaxAmount={maxAmount}
                />
              </Suspense>
            </div>
          </aside>

          {/* Tenders List */}
          <main className="lg:col-span-3">
            <Suspense fallback={<TendersListSkeleton />}>
              <TendersList 
                domain={domain}
                page={page}
                search={search}
                status={status}
                minAmount={minAmount}
                maxAmount={maxAmount}
              />
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  );
}

function FiltersSkeleton() {
  return (
    <div className="space-y-6 bg-card border border-border rounded-xl p-6">
      <Skeleton className="h-6 w-32" />
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

function TendersListSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="bg-card border border-border rounded-xl p-6">
          <Skeleton className="h-6 w-3/4 mb-4" />
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-2/3 mb-4" />
          <div className="flex gap-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}
