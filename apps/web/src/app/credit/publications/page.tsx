// src/app/credit/publications/page.tsx
import Link from "next/link";
import PublicationCard from "@/components/publications/PublicationCard";
import { listPublications } from "@/lib/publications";
import { listMethodologiesBySource, type Methodology } from "@/lib/methodologies";
import { cn } from "@/lib/utils";
import { Building2, FileText, ArrowRight } from "lucide-react";

type Params = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function CreditPublicationsPage({ searchParams }: Params) {
  const domain = "credit";
  const view = (searchParams.view as string) ?? "publications";
  const isMethodologies = view === "methodologies";
  
  // Credit domain always shows methodologies tab
  const showMethodologies = true;

  if (isMethodologies && showMethodologies) {
    return <MethodologiesView />;
  }

  // Original publications logic
  const page = Number(searchParams.page ?? 1) || 1;

  const { items, total, pageSize } = await listPublications({
    domain,
    page,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const mkHref = (p: number) => `/credit/publications?page=${p}`;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      {/* Tabs - always show for credit domain */}
      {showMethodologies && (
        <div className="flex items-center gap-2 border-b border-border pb-4">
          <Link
            href="/credit/publications?view=publications"
            className={cn(
              "px-4 py-2 rounded-lg border text-sm font-medium transition-colors",
              !isMethodologies 
                ? "bg-primary text-primary-foreground border-primary" 
                : "bg-card text-card-foreground border-border hover:bg-muted"
            )}
          >
            Publications
          </Link>
          <Link
            href="/credit/publications?view=methodologies"
            className={cn(
              "px-4 py-2 rounded-lg border text-sm font-medium transition-colors",
              isMethodologies 
                ? "bg-primary text-primary-foreground border-primary" 
                : "bg-card text-card-foreground border-border hover:bg-muted"
            )}
          >
            Methodologies
          </Link>
        </div>
      )}

      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Publications</h1>
          <p className="text-sm text-muted-foreground">
            Recent to oldest • Showing {start}-{end} of {total}
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-border p-10 text-center text-muted-foreground">
          No publications yet.
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((pub) => (
            <PublicationCard key={`credit-${pub.id}`} pub={pub} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-4">
        {page > 1 ? (
          <Link href={mkHref(page - 1)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            ← Prev
          </Link>
        ) : (
          <div />
        )}

        <div className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </div>

        {page < totalPages ? (
          <Link href={mkHref(page + 1)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Next →
          </Link>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}

async function MethodologiesView() {
  const { fitchBanks, fitchCorporates, spGlobal } = await listMethodologiesBySource();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-4">
        <Link
          href="/credit/publications?view=publications"
          className="px-4 py-2 rounded-lg border text-sm font-medium transition-colors bg-card text-card-foreground border-border hover:bg-muted"
        >
          Publications
        </Link>
        <Link
          href="/credit/publications?view=methodologies"
          className="px-4 py-2 rounded-lg border text-sm font-medium transition-colors bg-primary text-primary-foreground border-primary"
        >
          Methodologies
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Rating Methodologies</h1>
          <p className="text-sm text-muted-foreground">
            Explore comprehensive rating criteria from leading agencies - Fitch, Moody&apos;s and S&P across various sectors.
          </p>
        </div>
      </div>

      {/* Methodologies Sections */}
      <div className="space-y-12">
        <MethodologySection title="Fitch Banks" items={fitchBanks} icon={<Building2 className="h-5 w-5 text-primary" />} />
        <MethodologySection title="Fitch Corporates" items={fitchCorporates} icon={<FileText className="h-5 w-5 text-primary" />} />
        <MethodologySection title="S&P Global Criteria" items={spGlobal} icon={<Building2 className="h-5 w-5 text-primary" />} />
      </div>
    </div>
  );
}

function MethodologySection({ title, items, icon }: { title: string; items: Methodology[]; icon: React.ReactNode }) {
  if (!items.length) return null;
  
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        {icon}
        {title}
      </h2>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {items.map((m) => (
          <MethodologyCard key={m.id} methodology={m} />
        ))}
      </div>
    </section>
  );
}

function formatDate(d?: Date | null) {
  if (!d) return "No date available";
  return new Date(d).toLocaleDateString("en-US", { 
    year: "numeric", 
    month: "long", 
    day: "numeric" 
  });
}

function MethodologyCard({ methodology }: { methodology: Methodology }) {
  return (
    <article className="rounded-xl border border-border bg-card hover:shadow-md transition-shadow">
      <div className="p-5 space-y-3">
        <div className="text-xs text-muted-foreground">{formatDate(methodology.published_date)}</div>
        <h3 className="font-medium leading-snug line-clamp-2">{methodology.title}</h3>
        {methodology.abstract ? (
          <p className="text-sm text-muted-foreground line-clamp-4">{methodology.abstract}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">No abstract available.</p>
        )}
        <div className="pt-2">
          <Link
            href={`/credit/methodologies/${methodology.id}`}
            className="inline-flex items-center gap-2 text-sm rounded-lg border border-primary bg-primary/10 px-3 py-2 font-medium text-primary transition-colors hover:bg-primary/20"
          >
            View Details <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </article>
  );
}
