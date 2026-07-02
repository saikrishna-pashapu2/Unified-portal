import { getEventById, listEvents, eventRowToListItem } from "@/lib/events";
import { 
  CalendarDays, 
  MapPin, 
  Clock, 
  Globe, 
  ExternalLink, 
  Ticket, 
  Users, 
  ArrowLeft,
  Share2,
  Calendar,
  Building2,
  Sparkles,
  ChevronRight
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import ShareButton from "@/components/events/ShareButton";
import { TrackActivity } from "@/components/analytics/UserActivityTracker";

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
  
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
  return `${startDate.toLocaleDateString('en-US', options)} — ${endDate.toLocaleDateString('en-US', options)}`;
}

function getEventStatus(startDate?: string | null, endDate?: string | null): 'live' | 'upcoming' | 'past' {
  const now = new Date();
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  
  if (start && end) {
    if (now >= start && now <= end) return 'live';
    if (now < start) return 'upcoming';
    return 'past';
  }
  
  if (start) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const eventDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    if (eventDay.getTime() === today.getTime()) return 'live';
    if (eventDay > today) return 'upcoming';
    return 'past';
  }
  
  return 'upcoming';
}

function getDaysUntil(startDate?: string | null): number | null {
  if (!startDate) return null;
  const now = new Date();
  const start = new Date(startDate);
  const diffTime = start.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

export default async function CreditEventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  // Fetch related events (upcoming events)
  const { rows: relatedRows } = await listEvents({
    domain,
    page: 1,
    pageSize: 4,
  });
  const relatedEvents = relatedRows
    .map(eventRowToListItem)
    .filter(e => e.id !== event.id)
    .slice(0, 3);

  const dateRange = formatDateRange(event.start_date, event.end_date);
  const timeRange = [event.start_time, event.end_time].filter(Boolean).join(" – ");
  const status = getEventStatus(event.start_date, event.end_date);
  const daysUntil = getDaysUntil(event.start_date);
  const isWebinar = !event.location || event.location.toLowerCase().includes('webinar') || event.location.toLowerCase().includes('online');

  // Parse date for display
  const eventDate = event.start_date ? new Date(event.start_date) : null;
  const monthShort = eventDate?.toLocaleDateString('en-US', { month: 'short' });
  const dayNum = eventDate?.getDate();
  const yearNum = eventDate?.getFullYear();

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <TrackActivity
        action="view_event"
        resourceType="event"
        resourceId={numericId}
        details={`/${domain}/events/${numericId}`}
      />

      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Background gradient - Slate theme for Credit */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-700 to-slate-900"></div>
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10"></div>
        
        {/* Decorative elements */}
        <div className="absolute top-20 right-10 w-72 h-72 bg-white/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-10 left-10 w-96 h-96 bg-slate-500/10 rounded-full blur-3xl"></div>
        
        <div className="relative">
          {/* Navigation */}
          <div className="mx-auto max-w-[1400px] px-6 pt-6">
            <Link 
              href="/credit/events"
              className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors group"
            >
              <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
              Back to Events
            </Link>
          </div>

          {/* Hero Content */}
          <div className="mx-auto max-w-[1400px] px-6 py-12 pb-20">
            <div className="flex flex-col lg:flex-row gap-8 items-start">
              {/* Date Card */}
              {eventDate && (
                <div className="flex-shrink-0 hidden lg:block">
                  <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 text-center border border-white/20 shadow-xl">
                    <div className="text-white/70 text-sm font-medium uppercase tracking-wider">{monthShort}</div>
                    <div className="text-white text-5xl font-bold my-1">{dayNum}</div>
                    <div className="text-white/70 text-sm">{yearNum}</div>
                  </div>
                </div>
              )}

              {/* Event Info */}
              <div className="flex-1 min-w-0">
                {/* Status Badge */}
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  {status === 'live' && (
                    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500 text-white text-sm font-semibold shadow-lg shadow-blue-500/30">
                      <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                      Happening Now
                    </span>
                  )}
                  {status === 'upcoming' && daysUntil !== null && daysUntil > 0 && (
                    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/20 backdrop-blur-sm text-white text-sm font-medium">
                      <Sparkles size={14} />
                      {daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil} days`}
                    </span>
                  )}
                  {status === 'past' && (
                    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-white/70 text-sm font-medium">
                      Event Ended
                    </span>
                  )}
                  {event.source && (
                    <span className="px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm text-white text-sm font-medium">
                      {event.source}
                    </span>
                  )}
                </div>

                {/* Title */}
                <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6 leading-tight">
                  {event.title}
                </h1>

                {/* Quick Info */}
                <div className="flex flex-wrap gap-4 text-white/90">
                  {dateRange && (
                    <div className="flex items-center gap-2">
                      <CalendarDays size={18} className="text-white/70" />
                      <span>{dateRange}</span>
                    </div>
                  )}
                  {event.location && (
                    <div className="flex items-center gap-2">
                      {isWebinar ? <Globe size={18} className="text-white/70" /> : <MapPin size={18} className="text-white/70" />}
                      <span>{event.location}</span>
                    </div>
                  )}
                  {timeRange && (
                    <div className="flex items-center gap-2">
                      <Clock size={18} className="text-white/70" />
                      <span>{timeRange}{event.timezone ? ` (${event.timezone})` : ''}</span>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-3 mt-8">
                  {event.url && (
                    <Link
                      href={event.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-slate-800 font-semibold hover:bg-white/90 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                    >
                      <ExternalLink size={18} />
                      Visit Website
                    </Link>
                  )}
                  {event.tickets_url && (
                    <Link
                      href={event.tickets_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-600 text-white font-semibold hover:bg-slate-500 transition-all border border-white/20"
                    >
                      <Ticket size={18} />
                      Get Tickets
                    </Link>
                  )}
                  <ShareButton
                    title={event.title}
                    text={event.summary || `Check out this event: ${event.title}`}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 backdrop-blur-sm text-white font-semibold hover:bg-white/20 transition-all border border-white/20"
                  />
                </div>
              </div>

              {/* Event Image */}
              {event.image_url && (
                <div className="flex-shrink-0 w-full lg:w-80 xl:w-96">
                  <div className="rounded-2xl overflow-hidden shadow-2xl border border-white/20">
                    <img
                      src={event.image_url}
                      alt={event.title}
                      className="w-full h-48 lg:h-56 object-cover"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content Section */}
      <div className="mx-auto max-w-[1400px] px-6 py-12 -mt-8">
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* About Section */}
            <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-8 shadow-sm">
              <h2 className="text-2xl font-bold text-[var(--text)] mb-6 flex items-center gap-3">
                <div className="p-2 rounded-xl bg-slate-500/10">
                  <Calendar size={20} className="text-slate-600 dark:text-slate-400" />
                </div>
                About This Event
              </h2>
              {event.summary ? (
                <div className="prose prose-lg max-w-none text-[var(--text-muted)] leading-relaxed">
                  <p className="whitespace-pre-wrap">{event.summary}</p>
                </div>
              ) : (
                <p className="text-[var(--text-muted)] italic">No description available for this event.</p>
              )}
            </div>

            {/* Event Details Grid */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Date & Time Card */}
              {dateRange && (
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-slate-500/10">
                      <CalendarDays size={24} className="text-slate-600 dark:text-slate-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[var(--text)] mb-1">Date & Time</h3>
                      <p className="text-[var(--text-muted)]">{dateRange}</p>
                      {timeRange && (
                        <p className="text-sm text-[var(--text-muted)] mt-1">
                          {timeRange}{event.timezone ? ` (${event.timezone})` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Location Card */}
              {event.location && (
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-blue-500/10">
                      {isWebinar ? <Globe size={24} className="text-blue-600" /> : <MapPin size={24} className="text-blue-600" />}
                    </div>
                    <div>
                      <h3 className="font-semibold text-[var(--text)] mb-1">
                        {isWebinar ? 'Virtual Event' : 'Location'}
                      </h3>
                      <p className="text-[var(--text-muted)]">{event.location}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Organizer Card */}
              {event.organizer && (
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-purple-500/10">
                      <Building2 size={24} className="text-purple-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[var(--text)] mb-1">Organizer</h3>
                      <p className="text-[var(--text-muted)]">{event.organizer}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Source Card */}
              {event.source && (
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-orange-500/10">
                      <Users size={24} className="text-orange-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[var(--text)] mb-1">Source</h3>
                      <p className="text-[var(--text-muted)]">{event.source}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <aside className="space-y-6">
            {/* Quick Actions Card */}
            <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-6 shadow-sm sticky top-6">
              <h3 className="font-bold text-[var(--text)] mb-4 text-lg">Quick Actions</h3>
              <div className="space-y-3">
                {event.url && (
                  <Link
                    href={event.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between w-full px-4 py-3 rounded-xl bg-slate-500/10 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-500/20 transition-colors group"
                  >
                    <span className="flex items-center gap-2">
                      <Globe size={18} />
                      Visit Website
                    </span>
                    <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
                  </Link>
                )}
                
                {event.tickets_url && (
                  <Link
                    href={event.tickets_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between w-full px-4 py-3 rounded-xl bg-slate-700 text-white font-medium hover:bg-slate-600 transition-colors group"
                  >
                    <span className="flex items-center gap-2">
                      <Ticket size={18} />
                      Get Tickets
                    </span>
                    <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
                  </Link>
                )}

                <ShareButton
                  title={event.title}
                  text={event.summary || `Check out this event: ${event.title}`}
                  className="flex items-center justify-between w-full px-4 py-3 rounded-xl border border-[var(--border)] text-[var(--text)] font-medium hover:bg-[var(--surface-2)] transition-colors group"
                />
              </div>
            </div>

            {/* Related Events */}
            {relatedEvents.length > 0 && (
              <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-6 shadow-sm">
                <h3 className="font-bold text-[var(--text)] mb-4 text-lg">More Events</h3>
                <div className="space-y-3">
                  {relatedEvents.map((relatedEvent) => (
                    <Link
                      key={relatedEvent.id}
                      href={`/credit/events/${relatedEvent.id}`}
                      className="block p-3 rounded-xl hover:bg-[var(--surface-2)] transition-colors group"
                    >
                      <h4 className="font-medium text-[var(--text)] line-clamp-2 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">
                        {relatedEvent.title}
                      </h4>
                      {relatedEvent.start_date && (
                        <p className="text-sm text-[var(--text-muted)] mt-1 flex items-center gap-1">
                          <CalendarDays size={12} />
                          {new Date(relatedEvent.start_date).toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </p>
                      )}
                    </Link>
                  ))}
                </div>
                <Link 
                  href="/credit/events"
                  className="flex items-center justify-center gap-2 w-full mt-4 px-4 py-3 rounded-xl border border-[var(--border)] text-[var(--text)] font-medium hover:bg-[var(--surface-2)] transition-colors"
                >
                  Browse All Events
                  <ChevronRight size={16} />
                </Link>
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
