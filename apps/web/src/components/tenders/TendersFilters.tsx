'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search, DollarSign, Filter, X } from 'lucide-react';

interface TendersFiltersProps {
  domain: 'esg' | 'credit';
  currentSearch?: string;
  currentStatus?: string;
  currentMinAmount?: string;
  currentMaxAmount?: string;
}

export default function TendersFilters({
  domain,
  currentSearch = '',
  currentStatus = '',
  currentMinAmount = '',
  currentMaxAmount = '',
}: TendersFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(currentSearch);
  const [status, setStatus] = useState(currentStatus);
  const [minAmount, setMinAmount] = useState(currentMinAmount);
  const [maxAmount, setMaxAmount] = useState(currentMaxAmount);

  const applyFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    
    // Update search params
    if (search) {
      params.set('search', search);
    } else {
      params.delete('search');
    }

    if (status) {
      params.set('status', status);
    } else {
      params.delete('status');
    }

    if (minAmount) {
      params.set('minAmount', minAmount);
    } else {
      params.delete('minAmount');
    }

    if (maxAmount) {
      params.set('maxAmount', maxAmount);
    } else {
      params.delete('maxAmount');
    }

    // Reset to page 1
    params.set('page', '1');

    router.push(`${pathname}?${params.toString()}`);
  };

  const clearFilters = () => {
    setSearch('');
    setStatus('');
    setMinAmount('');
    setMaxAmount('');
    router.push(pathname);
  };

  const hasActiveFilters = search || status || minAmount || maxAmount;

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Filter className="h-5 w-5" />
          Filters
        </h3>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      {/* Search */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          Search
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title, description, customer..."
            className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                applyFilters();
              }
            }}
          />
        </div>
      </div>

      {/* Status */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          Status
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full px-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {/* Amount Range */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2 flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Amount Range
        </label>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            placeholder="Min"
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <input
            type="number"
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            placeholder="Max"
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Apply Button */}
      <button
        onClick={applyFilters}
        className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-medium py-2.5 px-4 rounded-lg transition-colors"
      >
        Apply Filters
      </button>
    </div>
  );
}
