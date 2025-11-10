import Link from 'next/link';
import { Calendar, DollarSign, Building2, ArrowRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Tender {
  id: number;
  tender_number: string;
  title: string;
  description: string | null;
  total_amount: number | null;
  currency: string | null;
  customer_name: string | null;
  application_end_date: Date | null;
  published_date: Date | null;
  status: string | null;
  primary_domain: string;
  domain_classification: any;
  tender_url: string;
}

interface TendersListProps {
  domain: 'esg' | 'credit';
  page: number;
  search?: string;
  status?: string;
  minAmount?: string;
  maxAmount?: string;
}

export default async function TendersList({
  domain,
  page,
  search,
  status,
  minAmount,
  maxAmount,
}: TendersListProps) {
  // Build query params
  const params = new URLSearchParams({
    domain,
    page: page.toString(),
    limit: '20',
  });

  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (minAmount) params.set('minAmount', minAmount);
  if (maxAmount) params.set('maxAmount', maxAmount);

  // Fetch tenders
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/tenders?${params.toString()}`, {
    cache: 'no-store',
  });

  if (!res.ok) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <p className="text-muted-foreground">Failed to load tenders.</p>
      </div>
    );
  }

  const { data: tenders, pagination } = await res.json();

  if (!tenders || tenders.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <p className="text-xl font-semibold text-foreground mb-2">
          No tenders found
        </p>
        <p className="text-muted-foreground">
          Try adjusting your filters or check back later.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Results Count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing <span className="font-medium text-foreground">{tenders.length}</span> of{' '}
          <span className="font-medium text-foreground">{pagination.total}</span> tenders
        </p>
      </div>

      {/* Tenders List */}
      <div className="space-y-4">
        {tenders.map((tender: Tender) => (
          <TenderCard key={tender.id} tender={tender} domain={domain} />
        ))}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          domain={domain}
          search={search}
          status={status}
          minAmount={minAmount}
          maxAmount={maxAmount}
        />
      )}
    </div>
  );
}

function TenderCard({ tender, domain }: { tender: Tender; domain: string }) {
  const deadlineDate = tender.application_end_date
    ? new Date(tender.application_end_date)
    : null;
  const now = new Date();
  const isExpired = deadlineDate && deadlineDate < now;
  
  // Calculate urgency (within 3 days)
  const threeDaysInMs = 3 * 24 * 60 * 60 * 1000;
  const timeUntilDeadline = deadlineDate ? deadlineDate.getTime() - now.getTime() : null;
  const isUrgent = timeUntilDeadline !== null && timeUntilDeadline > 0 && timeUntilDeadline <= threeDaysInMs;
  
  const timeRemaining = deadlineDate
    ? formatDistanceToNow(deadlineDate, { addSuffix: true })
    : null;

  // Determine if this is a published/active tender
  const isPublished = tender.status?.toLowerCase() === 'published';

  return (
    <Link
      href={`/${domain}/tenders/${tender.id}`}
      className={`block bg-card border rounded-xl p-6 transition-all hover:shadow-lg group ${
        isUrgent
          ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-950/20 hover:border-orange-600 shadow-md'
          : isPublished
          ? 'border-primary/30 hover:border-primary/50'
          : 'border-border hover:border-primary/50'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            {isUrgent && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-500 text-white animate-pulse">
                🔥 URGENT
              </span>
            )}
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
              {tender.primary_domain === 'both' ? 'ESG & Credit' : tender.primary_domain.toUpperCase()}
            </span>
            {tender.status && (
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                tender.status.toLowerCase() === 'published'
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
              }`}>
                {tender.status}
              </span>
            )}
          </div>
          <h3 className="text-xl font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2">
            {tender.title}
          </h3>
        </div>
        <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all flex-shrink-0" />
      </div>

      {/* Description */}
      {tender.description && (
        <p className="text-muted-foreground text-sm line-clamp-2 mb-4">
          {tender.description}
        </p>
      )}

      {/* Meta Information */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
        {/* Customer */}
        {tender.customer_name && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Building2 className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="truncate">{tender.customer_name}</span>
          </div>
        )}

        {/* Amount */}
        {tender.total_amount && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <DollarSign className="h-4 w-4 text-primary flex-shrink-0" />
            <span>
              {new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: tender.currency || 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              }).format(tender.total_amount)}
            </span>
          </div>
        )}

        {/* Deadline */}
        {deadlineDate && (
          <div className="flex items-center gap-2">
            <Calendar className={`h-4 w-4 flex-shrink-0 ${
              isExpired 
                ? 'text-red-500' 
                : isUrgent 
                ? 'text-orange-500' 
                : 'text-primary'
            }`} />
            <span className={`font-medium ${
              isExpired 
                ? 'text-red-500' 
                : isUrgent 
                ? 'text-orange-600 dark:text-orange-400' 
                : 'text-muted-foreground'
            }`}>
              {timeRemaining}
            </span>
          </div>
        )}
      </div>

      {/* Tender Number */}
      <div className="mt-4 pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Tender #{tender.tender_number}
        </p>
      </div>
    </Link>
  );
}

function Pagination({
  currentPage,
  totalPages,
  domain,
  search,
  status,
  minAmount,
  maxAmount,
}: {
  currentPage: number;
  totalPages: number;
  domain: string;
  search?: string;
  status?: string;
  minAmount?: string;
  maxAmount?: string;
}) {
  const buildUrl = (page: number) => {
    const params = new URLSearchParams();
    params.set('page', page.toString());
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (minAmount) params.set('minAmount', minAmount);
    if (maxAmount) params.set('maxAmount', maxAmount);
    return `/${domain}/tenders?${params.toString()}`;
  };

  const pages = [];
  const maxVisible = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);

  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center justify-center gap-2 mt-8">
      {/* Previous */}
      {currentPage > 1 && (
        <Link
          href={buildUrl(currentPage - 1)}
          className="px-4 py-2 bg-card border border-border hover:border-primary/50 rounded-lg text-sm font-medium transition-colors"
        >
          Previous
        </Link>
      )}

      {/* First page */}
      {startPage > 1 && (
        <>
          <Link
            href={buildUrl(1)}
            className="px-4 py-2 bg-card border border-border hover:border-primary/50 rounded-lg text-sm font-medium transition-colors"
          >
            1
          </Link>
          {startPage > 2 && (
            <span className="px-2 text-muted-foreground">...</span>
          )}
        </>
      )}

      {/* Page numbers */}
      {pages.map((page) => (
        <Link
          key={page}
          href={buildUrl(page)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            page === currentPage
              ? 'bg-primary text-primary-foreground'
              : 'bg-card border border-border hover:border-primary/50'
          }`}
        >
          {page}
        </Link>
      ))}

      {/* Last page */}
      {endPage < totalPages && (
        <>
          {endPage < totalPages - 1 && (
            <span className="px-2 text-muted-foreground">...</span>
          )}
          <Link
            href={buildUrl(totalPages)}
            className="px-4 py-2 bg-card border border-border hover:border-primary/50 rounded-lg text-sm font-medium transition-colors"
          >
            {totalPages}
          </Link>
        </>
      )}

      {/* Next */}
      {currentPage < totalPages && (
        <Link
          href={buildUrl(currentPage + 1)}
          className="px-4 py-2 bg-card border border-border hover:border-primary/50 rounded-lg text-sm font-medium transition-colors"
        >
          Next
        </Link>
      )}
    </div>
  );
}
