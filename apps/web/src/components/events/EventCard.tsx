"use client";
import Link from "next/link";
import { CalendarDays, MapPin, ExternalLink, Users, Clock, Globe, ArrowUpRight, Sparkles } from "lucide-react";
import type { EventListItem } from "@/lib/events";
import { useParams, usePathname } from "next/navigation";
import { fmtDateRange, fmtTime } from "@/lib/date";

type EventVariant = 'live' | 'upcoming' | 'past';

// Calculate days until event
function getDaysUntil(startDate?: string | null): number | null {
  if (!startDate) return null;
  const now = new Date();
  const start = new Date(startDate);
  const diffTime = start.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

export default function EventCard({ 
  event, 
  variant = 'upcoming',
  viewMode = 'grid',
  domain: domainProp
}: { 
  event: EventListItem;
  variant?: EventVariant;
  viewMode?: 'grid' | 'list';
  domain?: "esg" | "credit";
}) {
  const params = useParams();
  const pathname = usePathname();
  
  // Get domain from: 1) prop, 2) URL params, 3) pathname
  const domain = domainProp 
    || (params?.domain as "esg" | "credit") 
    || (pathname?.startsWith('/credit') ? 'credit' : 'esg');
  const dateText = fmtDateRange(event.start_date, event.end_date);
  const daysUntil = getDaysUntil(event.start_date || event.date);
  
  // Determine location text
  const locationText = event.location || 'Virtual';
  const isWebinar = !event.location || event.location.toLowerCase().includes('webinar') || event.location.toLowerCase().includes('online') || event.location.toLowerCase().includes('virtual');
  
  // Theme colors based on domain
  const isCredit = domain === 'credit';
  const brandGradient = isCredit 
    ? 'from-slate-600 to-slate-800' 
    : 'from-emerald-500 to-teal-600';

  // List view
  if (viewMode === 'list') {
    return (
      <Link 
        href={`/${domain}/events/${event.id}`}
        className={`group flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 ${
          variant === 'live' 
            ? 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/20 border-green-300 dark:border-green-700/50 shadow-green-100 dark:shadow-green-900/20' 
            : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--brand)]/40 hover:shadow-[var(--brand)]/5'
        }`}
      >
        {/* Date badge */}
        <div className={`flex-shrink-0 w-16 h-16 rounded-2xl flex flex-col items-center justify-center shadow-sm ${
          variant === 'live' 
            ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-green-200 dark:shadow-green-900/50' 
            : variant === 'past'
            ? 'bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 text-gray-500'
            : isCredit 
              ? 'bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-slate-200 dark:shadow-slate-900/50'
              : 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-200 dark:shadow-emerald-900/50'
        }`}>
          {event.start_date ? (
            <>
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                {new Date(event.start_date).toLocaleDateString('en-US', { month: 'short' })}
              </span>
              <span className="text-2xl font-bold leading-none">
                {new Date(event.start_date).getDate()}
              </span>
            </>
          ) : event.date ? (
            <>
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                {new Date(event.date).toLocaleDateString('en-US', { month: 'short' })}
              </span>
              <span className="text-2xl font-bold leading-none">
                {new Date(event.date).getDate()}
              </span>
            </>
          ) : (
            <CalendarDays className="h-6 w-6" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-bold text-[var(--text)] line-clamp-1 group-hover:text-[var(--brand)] transition-colors text-base">
                {event.title}
              </h3>
              <div className="flex items-center gap-3 mt-1.5 text-sm text-[var(--text-muted)]">
                <span className="flex items-center gap-1.5">
                  {isWebinar ? <Globe size={14} className="text-blue-500" /> : <MapPin size={14} className="text-rose-500" />}
                  <span className="line-clamp-1">{locationText}</span>
                </span>
                {event.source && (
                  <span className="hidden sm:inline px-2.5 py-0.5 rounded-full bg-[var(--surface-2)] text-xs font-medium border border-[var(--border)]">
                    {event.source}
                  </span>
                )}
              </div>
            </div>
            
            {/* Live badge or countdown */}
            {variant === 'live' ? (
              <span className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 text-white text-xs font-bold shadow-lg shadow-green-500/25">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                Live Now
              </span>
            ) : daysUntil !== null && daysUntil > 0 && daysUntil <= 7 ? (
              <span className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-semibold">
                <Sparkles size={12} />
                {daysUntil === 1 ? 'Tomorrow' : `${daysUntil} days`}
              </span>
            ) : (
              <ArrowUpRight className="flex-shrink-0 h-5 w-5 text-[var(--text-muted)] group-hover:text-[var(--brand)] transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            )}
          </div>
        </div>
      </Link>
    );
  }

  // Grid view (card)
  const eventDate = event.start_date || event.date;
  const parsedDate = eventDate ? new Date(eventDate) : null;
  
  return (
    <Link 
      href={`/${domain}/events/${event.id}`}
      className={`group relative flex flex-col rounded-2xl border overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${
        variant === 'live' 
          ? 'bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950/40 dark:via-emerald-950/30 dark:to-teal-950/20 border-green-300 dark:border-green-700/50 shadow-lg shadow-green-100 dark:shadow-green-900/30' 
          : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--brand)]/50 shadow-sm hover:shadow-[var(--brand)]/10'
      }`}
    >
      {/* Top gradient bar */}
      <div className={`h-1.5 w-full ${
        variant === 'live' 
          ? 'bg-gradient-to-r from-green-400 via-emerald-500 to-teal-500'
          : variant === 'past'
          ? 'bg-gradient-to-r from-gray-300 to-gray-400 dark:from-gray-600 dark:to-gray-700'
          : isCredit
          ? 'bg-gradient-to-r from-slate-500 via-slate-600 to-slate-700'
          : 'bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-500'
      }`}></div>

      {/* Live indicator */}
      {variant === 'live' && (
        <div className="absolute top-5 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 text-white text-xs font-bold shadow-lg shadow-green-500/30">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
          Live Now
        </div>
      )}
      
      {/* Countdown badge for upcoming events */}
      {variant === 'upcoming' && daysUntil !== null && daysUntil > 0 && daysUntil <= 7 && (
        <div className="absolute top-5 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-white text-xs font-bold shadow-lg shadow-amber-500/30">
          <Sparkles size={12} />
          {daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil} days`}
        </div>
      )}

      {/* Card body */}
      <div className="flex-1 p-5 pt-4">
        {/* Date card and location row */}
        <div className="flex items-start gap-4 mb-4">
          {/* Mini date card */}
          {parsedDate && (
            <div className={`flex-shrink-0 w-14 h-14 rounded-xl flex flex-col items-center justify-center shadow-sm ${
              variant === 'live'
                ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white'
                : variant === 'past'
                ? 'bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600 text-gray-600 dark:text-gray-300'
                : isCredit
                ? 'bg-gradient-to-br from-slate-600 to-slate-800 text-white'
                : 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white'
            }`}>
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-90">
                {parsedDate.toLocaleDateString('en-US', { month: 'short' })}
              </span>
              <span className="text-xl font-bold leading-none">
                {parsedDate.getDate()}
              </span>
            </div>
          )}
          
          {/* Location and time info */}
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] mb-1">
              {isWebinar ? (
                <Globe size={14} className="text-blue-500 flex-shrink-0" />
              ) : (
                <MapPin size={14} className="text-rose-500 flex-shrink-0" />
              )}
              <span className="line-clamp-1 font-medium">{locationText}</span>
            </div>
            {dateText && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <Clock size={12} className="flex-shrink-0" />
                <span>{dateText}</span>
              </div>
            )}
          </div>
        </div>

        {/* Title */}
        <h3 className="font-bold text-[var(--text)] line-clamp-2 mb-2 group-hover:text-[var(--brand)] transition-colors leading-snug text-base">
          {event.title}
        </h3>

        {/* Summary */}
        {event.summary ? (
          <p className="text-sm text-[var(--text-muted)] line-clamp-2 leading-relaxed">
            {event.summary}
          </p>
        ) : (
          <p className="text-sm text-[var(--text-muted)] italic opacity-60">
            No description available
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-[var(--border)] bg-gradient-to-r from-[var(--surface-2)]/50 to-transparent flex items-center justify-between">
        <div className="flex items-center gap-2">
          {event.source && (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${
              isCredit
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
            }`}>
              {event.source}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {event.url && (
            <span 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(event.url!, '_blank');
              }}
              className="p-2 rounded-lg hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--brand)] transition-all hover:scale-110 cursor-pointer"
              title="Visit website"
            >
              <ExternalLink size={16} />
            </span>
          )}
          <span className={`text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all group-hover:gap-2 ${
            isCredit
              ? 'text-slate-600 dark:text-slate-300 group-hover:bg-slate-100 dark:group-hover:bg-slate-800'
              : 'text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-900/30'
          }`}>
            View Details
            <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}