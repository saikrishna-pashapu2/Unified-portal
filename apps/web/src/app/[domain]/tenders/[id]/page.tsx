import { notFound } from 'next/navigation';
import { esgPrisma as db } from '@esgcredit/db-esg';
import Link from 'next/link';
import { ArrowLeft, Calendar, DollarSign, Building2, FileText, ExternalLink, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import TenderSaveButton from '@/components/tenders/TenderSaveButton';

export const revalidate = 300;

export default async function TenderDetailPage({
  params,
}: {
  params: { domain: 'esg' | 'credit'; id: string };
}) {
  const tender = await db.tenders.findUnique({
    where: {
      id: parseInt(params.id),
    },
    include: {
      tender_classifications: true,
    },
  });

  if (!tender || !tender.is_active) {
    notFound();
  }

  // Check if tender belongs to this domain
  if (
    tender.primary_domain !== params.domain &&
    tender.primary_domain !== 'both'
  ) {
    notFound();
  }

  // Calculate time remaining until deadline
  const deadlineDate = tender.application_end_date;
  const isExpired = deadlineDate && new Date(deadlineDate) < new Date();
  const timeRemaining = deadlineDate 
    ? formatDistanceToNow(new Date(deadlineDate), { addSuffix: true })
    : null;

  // Get domain scores from classification
  const classification = tender.tender_classifications;
  const esgScore = classification ? Number(classification.esg_score || 0) * 100 : 0;
  const creditScore = classification ? Number(classification.credit_score || 0) * 100 : 0;

  // Get matched keywords
  const esgKeywords = classification?.esg_keywords || [];
  const creditKeywords = classification?.credit_keywords || [];
  const matchedKeywords = [...esgKeywords, ...creditKeywords];

  return (
    <div className="min-h-screen bg-background">
      {/* Back Button */}
      <div className="border-b border-border bg-card/50">
        <div className="mx-auto max-w-[1200px] px-6 py-4">
          <Link
            href={`/${params.domain}/tenders`}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Tenders
          </Link>
        </div>
      </div>

      {/* Header */}
      <div className="bg-gradient-to-b from-primary/5 to-transparent border-b border-border">
        <div className="mx-auto max-w-[1200px] px-6 py-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                  {tender.primary_domain === 'both' ? 'ESG & Credit' : tender.primary_domain.toUpperCase()}
                </span>
                {tender.status && (
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                    tender.status === 'active' 
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                  }`}>
                    {tender.status}
                  </span>
                )}
                {isExpired && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                    Expired
                  </span>
                )}
              </div>
              <h1 className="text-3xl font-bold text-foreground mb-4">
                {tender.title}
              </h1>
              <p className="text-sm text-muted-foreground">
                Tender #{tender.tender_number}
              </p>
            </div>
            <TenderSaveButton tenderId={tender.id} />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center">
                <FileText className="mr-2 h-5 w-5 text-primary" />
                Description
              </h2>
              <div className="prose dark:prose-invert max-w-none">
                <p className="text-muted-foreground whitespace-pre-wrap">
                  {tender.description || 'No description available.'}
                </p>
              </div>
            </div>

            {/* Additional Info */}
            {tender.additional_info && (
              <div className="bg-card border border-border rounded-xl p-6">
                <h2 className="text-xl font-semibold text-foreground mb-4">
                  Additional Information
                </h2>
                <div className="prose dark:prose-invert max-w-none">
                  <p className="text-muted-foreground whitespace-pre-wrap">
                    {tender.additional_info}
                  </p>
                </div>
              </div>
            )}

            {/* Matched Keywords */}
            {matchedKeywords.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-6">
                <h2 className="text-xl font-semibold text-foreground mb-4">
                  Matched Keywords
                </h2>
                <div className="flex flex-wrap gap-2">
                  {matchedKeywords.map((keyword: string, index: number) => (
                    <span
                      key={index}
                      className="px-3 py-1 bg-secondary text-secondary-foreground rounded-full text-sm"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            {/* Deadline Card */}
            {deadlineDate && (
              <div className={`bg-card border-2 rounded-xl p-6 ${
                isExpired ? 'border-red-500/50' : 'border-primary/50'
              }`}>
                <div className="flex items-start gap-3">
                  {isExpired ? (
                    <AlertCircle className="h-6 w-6 text-red-500 mt-1" />
                  ) : (
                    <Calendar className="h-6 w-6 text-primary mt-1" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Application Deadline
                    </p>
                    <p className="text-xl font-bold text-foreground">
                      {new Date(deadlineDate).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                    <p className={`text-sm mt-1 ${
                      isExpired ? 'text-red-500' : 'text-primary'
                    }`}>
                      {timeRemaining}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Key Information */}
            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
              <h3 className="text-lg font-semibold text-foreground">
                Key Information
              </h3>

              {/* Amount */}
              {tender.total_amount && (
                <div className="flex items-start gap-3">
                  <DollarSign className="h-5 w-5 text-primary mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">Total Amount</p>
                    <p className="text-lg font-semibold text-foreground">
                      {new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: tender.currency || 'USD',
                        minimumFractionDigits: 0,
                      }).format(Number(tender.total_amount))}
                    </p>
                  </div>
                </div>
              )}

              {/* Customer */}
              {tender.customer_name && (
                <div className="flex items-start gap-3">
                  <Building2 className="h-5 w-5 text-primary mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">Customer</p>
                    <p className="font-medium text-foreground">
                      {tender.customer_name}
                    </p>
                  </div>
                </div>
              )}

              {/* Published Date */}
              {tender.published_date && (
                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-primary mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">Published</p>
                    <p className="font-medium text-foreground">
                      {new Date(tender.published_date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Domain Scores */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                Domain Relevance
              </h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">ESG Score</span>
                    <span className="font-medium text-foreground">{esgScore}%</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500"
                      style={{ width: `${esgScore}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Credit Score</span>
                    <span className="font-medium text-foreground">{creditScore}%</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500"
                      style={{ width: `${creditScore}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* View Original Button */}
            {tender.tender_url && (
              <a
                href={tender.tender_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground hover:bg-primary/90 font-medium py-3 px-4 rounded-lg transition-colors"
              >
                View Original Tender
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
