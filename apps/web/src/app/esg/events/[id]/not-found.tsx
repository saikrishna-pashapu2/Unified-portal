import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function EventNotFound() {
  return (
    <main className="mx-auto max-w-[1200px] px-6 py-16">
      <div className="text-center">
        <div className="mb-8">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[var(--surface-2)]">
            <span className="text-2xl font-bold text-[var(--text-muted)]">404</span>
          </div>
          <h1 className="mb-4 text-3xl font-bold text-[var(--text)]">Event Not Found</h1>
          <p className="text-[var(--text-muted)] max-w-md mx-auto">
            The event you&apos;re looking for doesn&apos;t exist or may have been removed.
          </p>
        </div>
        
        <div className="flex gap-4 justify-center">
          <Link 
            href="/esg/events"
            className="btn btn-primary inline-flex items-center gap-2"
          >
            <ArrowLeft size={16} />
            Back to ESG Events
          </Link>
        </div>
      </div>
    </main>
  );
}
