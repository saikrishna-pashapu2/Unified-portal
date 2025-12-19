import { getEventById } from "@/lib/events";
import { CalendarDays, MapPin, Clock, Globe, ExternalLink, Ticket, Users, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import ShareButton from "@/components/events/ShareButton";

function formatDateTime(date?: string | null, time?: string | null, timezone?: string | null) {
  if (!date) return null;
  
  const dateObj = new Date(date);
  const dateStr = dateObj.toLocaleDateString('en-US', { 
    weekday: 'long',
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  if (!time) return dateStr;
  return `${dateStr} at ${time}${timezone ? ` (${timezone})` : ''}`;
}

function formatDateRange(start?: string | null, end?: string | null) {
  if (!start && !end) return null;
  if (start && !end) return formatDateTime(start);
  if (!start && end) return formatDateTime(end);
  
  const startDate = new Date(start!);
  const endDate = new Date(end!);
  
  if (startDate.toDateString() === endDate.toDateString()) {
    return formatDateTime(start);
  }
  
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
  return `${startDate.toLocaleDateString('en-US', options)} → ${endDate.toLocaleDateString('en-US', options)}`;
}

export default async function CreditEventDetailPage({
  params: { id },
}: {
  params: { id: string };
}) {
  const domain = "credit";
  
  // Validate ID
  const numericId = parseInt(id);
  if (isNaN(numericId) || numericId <= 0) {
    notFound();
  }
  
  const event = await getEventById(domain, id);
  
  if (!event) {
    notFound();
  }

  const dateRange = formatDateRange(event.start_date, event.end_date);
  const timeRange = [event.start_time, event.end_time].filter(Boolean).join(" – ");

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-8">
      {/* Back button */}
      <div className="mb-6">
        <Link 
          href="/credit/events"
          className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Events
        </Link>
      </div>

      {/* Header */}
      <header className="mb-8">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <h1 className="mb-2 text-4xl font-bold text-[var(--text)] leading-tight">
              {event.title}
            </h1>
            {event.source && (
              <div className="mb-4">
                <span className="rounded-full bg-slate-500/10 px-3 py-1 text-sm font-medium text-slate-600 dark:text-slate-400">
                  {event.source}
                </span>
              </div>
            )}
          </div>
          
          {/* Action buttons */}
          <div className="flex gap-3">
            {event.url && (
              <Link
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary inline-flex items-center gap-2"
              >
                <ExternalLink size={16} />
                Website
              </Link>
            )}
            {event.tickets_url && (
              <Link
                href={event.tickets_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary inline-flex items-center gap-2"
              >
                <Ticket size={16} />
                Get Tickets
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Event image */}
          {event.image_url && (
            <div className="surface rounded-2xl overflow-hidden">
              <img
                src={event.image_url}
                alt={event.title}
                className="w-full h-64 object-cover"
              />
            </div>
          )}

          {/* Summary/Description */}
          {event.summary && (
            <div className="surface rounded-2xl p-6">
              <h2 className="mb-4 text-xl font-semibold text-[var(--text)]">About This Event</h2>
              <div className="prose prose-sm max-w-none text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">
                {event.summary}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-6">
          {/* Event details card */}
          <div className="surface rounded-2xl p-6 space-y-4">
            <h3 className="font-semibold text-[var(--text)] mb-4">Event Details</h3>
            
            {dateRange && (
              <div className="flex items-start gap-3">
                <CalendarDays size={18} className="mt-0.5 text-slate-600 dark:text-slate-400" />
                <div>
                  <div className="font-medium text-[var(--text)]">{dateRange}</div>
                  {timeRange && (
                    <div className="text-sm text-[var(--text-muted)] flex items-center gap-1 mt-1">
                      <Clock size={14} />
                      {timeRange}{event.timezone ? ` (${event.timezone})` : ''}
                    </div>
                  )}
                </div>
              </div>
            )}

            {event.location && (
              <div className="flex items-start gap-3">
                <MapPin size={18} className="mt-0.5 text-slate-600 dark:text-slate-400" />
                <div>
                  <div className="font-medium text-[var(--text)]">Location</div>
                  <div className="text-sm text-[var(--text-muted)]">{event.location}</div>
                </div>
              </div>
            )}

            {event.organizer && (
              <div className="flex items-start gap-3">
                <Users size={18} className="mt-0.5 text-slate-600 dark:text-slate-400" />
                <div>
                  <div className="font-medium text-[var(--text)]">Organizer</div>
                  <div className="text-sm text-[var(--text-muted)]">{event.organizer}</div>
                </div>
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="surface rounded-2xl p-6 space-y-3">
            <h3 className="font-semibold text-[var(--text)] mb-4">Quick Actions</h3>
            
            {event.url && (
              <Link
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary w-full justify-center"
              >
                <Globe size={16} />
                Visit Website
              </Link>
            )}
            
            {event.tickets_url && (
              <Link
                href={event.tickets_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary w-full justify-center"
              >
                <Ticket size={16} />
                Get Tickets
              </Link>
            )}

            <ShareButton
              title={event.title}
              text={event.summary || `Check out this event: ${event.title}`}
            />
          </div>

          {/* Related events placeholder */}
          <div className="surface rounded-2xl p-6">
            <h3 className="font-semibold text-[var(--text)] mb-4">More Events</h3>
            <div className="text-sm text-[var(--text-muted)] text-center py-8">
              Related events will be shown here
            </div>
            <Link 
              href="/credit/events"
              className="btn btn-secondary w-full justify-center"
            >
              Browse All Events
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
