// src/app/credit/events/page.tsx
import { listEvents, getEventSources, eventRowToListItem } from "@/lib/events";
import EventCard from "@/components/events/EventCard";
import EventsFilterBar from "@/components/events/EventsFilterBar";
import EventsPaginator from "@/components/events/EventsPaginator";
import EmptyResult from "@/components/ui/empty-result";
import { Calendar, TrendingUp, CalendarDays, Clock, Zap } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CreditEventsPage({
  searchParams,
}: {
  searchParams: { page?: string; pageSize?: string; view?: string; q?: string; source?: string; dateRange?: string };
}) {
  const domain = "credit";
  const page = Math.max(1, Number(searchParams.page ?? "1"));
  const pageSize = Math.min(50, Math.max(5, Number(searchParams.pageSize ?? "20")));
  const viewMode = searchParams.view || "grid";
  const searchQuery = searchParams.q?.trim() || undefined;
  const sourceFilter = searchParams.source?.trim() || undefined;
  const dateRangeFilter = searchParams.dateRange?.trim() || undefined;

  const sources = await getEventSources(domain);
  const { rows, total } = await listEvents({
    domain,
    page,
    pageSize,
    q: searchQuery,
    source: sourceFilter,
    dateRange: dateRangeFilter,
  });

  const events = rows.map(eventRowToListItem);
  const serializedEvents = JSON.parse(JSON.stringify(events));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Categorize events
  const now = new Date();
  const categorizedEvents = {
    happening: serializedEvents.filter((e: any) => {
      if (e.date) {
        const eventDate = new Date(e.date);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
        return eventDay.getTime() === today.getTime();
      }
      const start = e.start_date ? new Date(e.start_date) : null;
      const end = e.end_date ? new Date(e.end_date) : null;
      if (start && end) return start <= now && end >= now;
      if (start) {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const eventDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        return eventDay.getTime() === today.getTime();
      }
      return false;
    }),
    upcoming: serializedEvents.filter((e: any) => {
      if (e.date) {
        const eventDate = new Date(e.date);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
        return eventDay > today;
      }
      const start = e.start_date ? new Date(e.start_date) : null;
      if (start) return start > now;
      return true;
    }),
    past: serializedEvents.filter((e: any) => {
      if (e.date) {
        const eventDate = new Date(e.date);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
        return eventDay < today;
      }
      const end = e.end_date ? new Date(e.end_date) : null;
      if (end) return end < now;
      return false;
    }),
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-[var(--surface)] to-[var(--background)]">
      {/* Compact Hero - Slate styling for Credit */}
      <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
        
        <div className="relative mx-auto max-w-[1400px] px-6 py-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            {/* Title Section */}
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-sm">
                <Calendar className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white tracking-tight">
                  Credit Events
                </h1>
                <p className="text-white/70 text-sm mt-1">
                  Conferences, webinars & industry gatherings
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/10 backdrop-blur-sm">
                <TrendingUp className="h-4 w-4 text-white/70" />
                <div className="text-right">
                  <div className="text-2xl font-bold text-white">{total}</div>
                  <div className="text-[10px] uppercase tracking-wider text-white/50">Events</div>
                </div>
              </div>
              
              {categorizedEvents.happening.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-500/20 backdrop-blur-sm border border-slate-400/20">
                  <div className="relative">
                    <Zap className="h-4 w-4 text-slate-300" />
                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-slate-300 rounded-full animate-ping"></span>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-slate-300">{categorizedEvents.happening.length}</div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400/70">Live</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        {/* Filter Bar */}
        <EventsFilterBar sources={sources} domain={domain} />
        
        {serializedEvents.length === 0 ? (
          <div className="mt-8">
            <EmptyResult
              title="No events found"
              description="We couldn't find any events matching your criteria. Try adjusting your filters or check back later."
            />
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {/* Live Events */}
            {categorizedEvents.happening.length > 0 && (
              <section>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-500/10 border border-slate-500/20">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-500"></span>
                    </span>
                    <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Happening Now</span>
                  </div>
                </div>
                <div className={viewMode === 'list' ? 'space-y-3' : 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3'}>
                  {categorizedEvents.happening.map((e: any) => (
                    <EventCard 
                      key={`happening-${e.id}`} 
                      event={e}
                      variant="live"
                      viewMode={viewMode as 'grid' | 'list'}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Upcoming Events */}
            {categorizedEvents.upcoming.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-[var(--brand)]" />
                    <h2 className="text-lg font-semibold text-[var(--text)]">Upcoming Events</h2>
                  </div>
                  <span className="text-sm text-[var(--text-muted)]">
                    {categorizedEvents.upcoming.length} event{categorizedEvents.upcoming.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className={viewMode === 'list' ? 'space-y-3' : 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3'}>
                  {categorizedEvents.upcoming.map((e: any) => (
                    <EventCard 
                      key={`upcoming-${e.id}`} 
                      event={e}
                      variant="upcoming"
                      viewMode={viewMode as 'grid' | 'list'}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Past Events */}
            {categorizedEvents.past.length > 0 && (
              <section className="opacity-70">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-[var(--text-muted)]" />
                    <h2 className="text-lg font-medium text-[var(--text-muted)]">Past Events</h2>
                  </div>
                  <span className="text-sm text-[var(--text-muted)]">
                    {categorizedEvents.past.length} event{categorizedEvents.past.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className={viewMode === 'list' ? 'space-y-3' : 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3'}>
                  {categorizedEvents.past.map((e: any) => (
                    <EventCard 
                      key={`past-${e.id}`} 
                      event={e}
                      variant="past"
                      viewMode={viewMode as 'grid' | 'list'}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <EventsPaginator
                page={page}
                totalPages={totalPages}
                pageSize={pageSize}
              />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
