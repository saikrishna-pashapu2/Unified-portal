"use client";
import Link from "next/link";
import { CalendarDays, MapPin, ExternalLink, Users, Clock, Globe, ArrowUpRight } from "lucide-react";
import type { EventListItem } from "@/lib/events";
import { useParams } from "next/navigation";
import { fmtDateRange, fmtTime } from "@/lib/date";

type EventVariant = 'live' | 'upcoming' | 'past';

export default function EventCard({ 
  event, 
  variant = 'upcoming',
  viewMode = 'grid' 
}: { 
  event: EventListItem;
  variant?: EventVariant;
  viewMode?: 'grid' | 'list';
}) {
  const { domain } = useParams() as { domain: "esg" | "credit" };
  const dateText = fmtDateRange(event.start_date, event.end_date);
  
  // Determine location text
  const locationText = event.location || 'Webinar';
  const isWebinar = !event.location || event.location.toLowerCase().includes('webinar') || event.location.toLowerCase().includes('online');

  // List view
  if (viewMode === 'list') {
    return (
      <Link 
        href={`/${domain}/events/${event.id}`}
        className={`group flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 hover:shadow-md ${
          variant === 'live' 
            ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800/30' 
            : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--brand)]/30'
        }`}
      >
        {/* Date badge */}
        <div className={`flex-shrink-0 w-14 h-14 rounded-xl flex flex-col items-center justify-center ${
          variant === 'live' 
            ? 'bg-green-500 text-white' 
            : variant === 'past'
            ? 'bg-gray-100 dark:bg-gray-800 text-gray-500'
            : 'bg-[var(--brand)]/10 text-[var(--brand)]'
        }`}>
          {event.start_date ? (
            <>
              <span className="text-xs font-medium uppercase">
                {new Date(event.start_date).toLocaleDateString('en-US', { month: 'short' })}
              </span>
              <span className="text-lg font-bold leading-none">
                {new Date(event.start_date).getDate()}
              </span>
            </>
          ) : event.date ? (
            <>
              <span className="text-xs font-medium uppercase">
                {new Date(event.date).toLocaleDateString('en-US', { month: 'short' })}
              </span>
              <span className="text-lg font-bold leading-none">
                {new Date(event.date).getDate()}
              </span>
            </>
          ) : (
            <CalendarDays className="h-5 w-5" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold text-[var(--text)] line-clamp-1 group-hover:text-[var(--brand)] transition-colors">
                {event.title}
              </h3>
              <div className="flex items-center gap-3 mt-1 text-sm text-[var(--text-muted)]">
                <span className="flex items-center gap-1">
                  {isWebinar ? <Globe size={12} /> : <MapPin size={12} />}
                  <span className="line-clamp-1">{locationText}</span>
                </span>
                {event.source && (
                  <span className="hidden sm:inline px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-xs">
                    {event.source}
                  </span>
                )}
              </div>
            </div>
            
            {/* Live badge or arrow */}
            {variant === 'live' ? (
              <span className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500 text-white text-xs font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                Live
              </span>
            ) : (
              <ArrowUpRight className="flex-shrink-0 h-4 w-4 text-[var(--text-muted)] group-hover:text-[var(--brand)] transition-colors" />
            )}
          </div>
        </div>
      </Link>
    );
  }

  // Grid view (card)
  return (
    <Link 
      href={`/${domain}/events/${event.id}`}
      className={`group relative flex flex-col rounded-xl border overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 ${
        variant === 'live' 
          ? 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/20 border-green-200 dark:border-green-800/30' 
          : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--brand)]/30'
      }`}
    >
      {/* Live indicator */}
      {variant === 'live' && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500 text-white text-xs font-semibold shadow-lg">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
          Live
        </div>
      )}

      {/* Card body */}
      <div className="flex-1 p-5">
        {/* Date and location row */}
        <div className="flex items-center gap-2 mb-3">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${
            variant === 'live' 
              ? 'bg-green-500/10 text-green-700 dark:text-green-400' 
              : variant === 'past'
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-500'
              : 'bg-[var(--brand)]/10 text-[var(--brand)]'
          }`}>
            <CalendarDays size={12} />
            <span>{dateText || 'TBA'}</span>
          </div>
          
          <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
            {isWebinar ? <Globe size={12} /> : <MapPin size={12} />}
            <span className="line-clamp-1">{locationText}</span>
          </div>
        </div>

        {/* Title */}
        <h3 className="font-semibold text-[var(--text)] line-clamp-2 mb-2 group-hover:text-[var(--brand)] transition-colors leading-snug">
          {event.title}
        </h3>

        {/* Summary */}
        {event.summary && (
          <p className="text-sm text-[var(--text-muted)] line-clamp-2 mb-3 leading-relaxed">
            {event.summary}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--surface-2)]/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {event.source && (
            <span className="text-xs font-medium text-[var(--text-muted)] px-2 py-1 rounded-md bg-[var(--surface)]">
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
              className="p-1.5 rounded-lg hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--brand)] transition-colors cursor-pointer"
              title="Visit website"
            >
              <ExternalLink size={14} />
            </span>
          )}
          <span className="text-xs text-[var(--brand)] font-medium group-hover:underline flex items-center gap-1">
            Details
            <ArrowUpRight size={12} />
          </span>
        </div>
      </div>
    </Link>
  );
}