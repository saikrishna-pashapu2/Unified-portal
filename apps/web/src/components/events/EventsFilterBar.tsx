"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search, X, Grid3x3, List, Calendar, ChevronDown, SlidersHorizontal } from "lucide-react";

const dateRangeLabels: Record<string, string> = {
  '': 'All upcoming',
  'this-week': 'This week',
  'this-month': 'This month',
  'upcoming': 'Upcoming',
  'past': 'Past events'
};

export default function EventsFilterBar({ 
  sources, 
  domain 
}: { 
  sources: string[]; 
  domain: "esg" | "credit";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [selectedSource, setSelectedSource] = useState(searchParams.get("source") ?? "");
  const [dateRange, setDateRange] = useState(searchParams.get("dateRange") ?? "");
  const [viewMode, setViewMode] = useState(searchParams.get("view") ?? "grid");

  // Navigate with updated params
  const navigateWithParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    // Reset page on filter change
    if (!updates.hasOwnProperty('page')) {
      params.delete('page');
    }
    router.push(`/${domain}/events${params.toString() ? '?' + params.toString() : ''}`);
  };

  // Handle search submit
  const handleSearch = () => {
    navigateWithParams({ q: query.trim() || null });
  };

  // Clear all filters
  const handleClearFilters = () => {
    setQuery("");
    setSelectedSource("");
    setDateRange("");
    navigateWithParams({ q: null, source: null, dateRange: null });
  };

  // Handle date range change - immediately apply
  const handleDateRangeChange = (value: string) => {
    setDateRange(value);
    navigateWithParams({ dateRange: value || null });
  };

  // Handle source change - immediately apply
  const handleSourceChange = (value: string) => {
    setSelectedSource(value);
    navigateWithParams({ source: value || null });
  };

  // Toggle view mode
  const handleViewModeChange = (mode: string) => {
    setViewMode(mode);
    const params = new URLSearchParams(searchParams);
    if (mode === 'grid') {
      params.delete('view');
    } else {
      params.set('view', mode);
    }
    router.push(`/${domain}/events${params.toString() ? '?' + params.toString() : ''}`);
  };

  // Check if any filters are active
  const hasActiveFilters = query.trim() || selectedSource || dateRange;
  const activeFilterCount = (query.trim() ? 1 : 0) + (selectedSource ? 1 : 0) + (dateRange ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Main filter row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search input */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search events..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2 pl-9 pr-10 text-sm focus-ring focus:border-[var(--brand)] transition-all placeholder:text-[var(--text-muted)]"
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                navigateWithParams({ q: null });
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[var(--surface-2)] text-[var(--text-muted)]"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Date range dropdown */}
        <div className="relative">
          <select
            value={dateRange}
            onChange={(e) => handleDateRangeChange(e.target.value)}
            className="appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2 pl-3 pr-8 text-sm focus-ring focus:border-[var(--brand)] cursor-pointer"
          >
            <option value="">All upcoming</option>
            <option value="this-week">This week</option>
            <option value="this-month">This month</option>
            <option value="past">Past events</option>
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
        </div>

        {/* Source dropdown */}
        {sources.length > 0 && (
          <div className="relative">
            <select
              value={selectedSource}
              onChange={(e) => handleSourceChange(e.target.value)}
              className="appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2 pl-3 pr-8 text-sm focus-ring focus:border-[var(--brand)] cursor-pointer"
            >
              <option value="">All sources</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          </div>
        )}

        {/* View toggle */}
        <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
          <button
            onClick={() => handleViewModeChange('grid')}
            className={`rounded-md p-1.5 transition-colors ${
              viewMode === 'grid'
                ? 'bg-[var(--brand)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
            title="Grid view"
          >
            <Grid3x3 size={16} />
          </button>
          <button
            onClick={() => handleViewModeChange('list')}
            className={`rounded-md p-1.5 transition-colors ${
              viewMode === 'list'
                ? 'bg-[var(--brand)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
            title="List view"
          >
            <List size={16} />
          </button>
        </div>

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            onClick={handleClearFilters}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <X size={14} />
            Clear
          </button>
        )}
      </div>

      {/* Active filter pills */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">Active filters:</span>
          
          {query.trim() && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)]/10 px-2.5 py-1 text-xs font-medium text-[var(--brand)]">
              <Search size={10} />
              &quot;{query.trim()}&quot;
              <button
                onClick={() => {
                  setQuery("");
                  navigateWithParams({ q: null });
                }}
                className="ml-0.5 p-0.5 rounded-full hover:bg-[var(--brand)]/20"
              >
                <X size={10} />
              </button>
            </span>
          )}
          
          {dateRange && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)]/10 px-2.5 py-1 text-xs font-medium text-[var(--brand)]">
              <Calendar size={10} />
              {dateRangeLabels[dateRange] || dateRange}
              <button
                onClick={() => {
                  setDateRange("");
                  navigateWithParams({ dateRange: null });
                }}
                className="ml-0.5 p-0.5 rounded-full hover:bg-[var(--brand)]/20"
              >
                <X size={10} />
              </button>
            </span>
          )}

          {selectedSource && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)]/10 px-2.5 py-1 text-xs font-medium text-[var(--brand)]">
              <SlidersHorizontal size={10} />
              {selectedSource}
              <button
                onClick={() => {
                  setSelectedSource("");
                  navigateWithParams({ source: null });
                }}
                className="ml-0.5 p-0.5 rounded-full hover:bg-[var(--brand)]/20"
              >
                <X size={10} />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}