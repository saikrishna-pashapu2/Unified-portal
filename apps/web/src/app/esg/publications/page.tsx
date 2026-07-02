// src/app/esg/publications/page.tsx
import Link from "next/link";
import PublicationCard from "@/components/publications/PublicationCard";
import { listPublications } from "@/lib/publications";

type Params = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PublicationsPage({ searchParams }: Params) {
  const resolvedSearchParams = await searchParams;
  const domain = "esg";
  const page = Number(resolvedSearchParams.page ?? 1) || 1;

  const { items, total, pageSize } = await listPublications({
    domain,
    page,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const mkHref = (p: number) => `/esg/publications?page=${p}`;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
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
            <PublicationCard key={`${domain}-${pub.id}`} pub={pub} />
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
