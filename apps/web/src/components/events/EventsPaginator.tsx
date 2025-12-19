// src/components/events/EventsPaginator.tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function EventsPaginator({
  page,
  totalPages,
  pageSize,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setPage = (p: number) => {
    const sp = new URLSearchParams(searchParams?.toString());
    sp.set("page", String(p));
    sp.set("pageSize", String(pageSize));
    router.push(`${pathname}?${sp.toString()}`);
  };

  // Generate page numbers to show
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const showEllipsis = totalPages > 7;
    
    if (!showEllipsis) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (page <= 3) {
        pages.push(1, 2, 3, 4, '...', totalPages);
      } else if (page >= totalPages - 2) {
        pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, '...', page - 1, page, page + 1, '...', totalPages);
      }
    }
    
    return pages;
  };

  return (
    <div className="flex items-center justify-center gap-1">
      {/* Previous button */}
      <button
        disabled={page <= 1}
        onClick={() => setPage(page - 1)}
        className="flex items-center gap-1 px-3 py-2 rounded-lg border border-[var(--border)] text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--surface-2)] transition-colors"
      >
        <ChevronLeft size={16} />
        <span className="hidden sm:inline">Previous</span>
      </button>

      {/* Page numbers */}
      <div className="flex items-center gap-1 mx-2">
        {getPageNumbers().map((p, idx) => (
          typeof p === 'string' ? (
            <span key={`ellipsis-${idx}`} className="px-2 text-[var(--text-muted)]">
              {p}
            </span>
          ) : (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`min-w-[36px] h-9 rounded-lg text-sm font-medium transition-colors ${
                p === page
                  ? 'bg-[var(--brand)] text-white'
                  : 'hover:bg-[var(--surface-2)] text-[var(--text)]'
              }`}
            >
              {p}
            </button>
          )
        ))}
      </div>

      {/* Next button */}
      <button
        disabled={page >= totalPages}
        onClick={() => setPage(page + 1)}
        className="flex items-center gap-1 px-3 py-2 rounded-lg border border-[var(--border)] text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--surface-2)] transition-colors"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}