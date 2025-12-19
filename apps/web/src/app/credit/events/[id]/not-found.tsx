import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function CreditEventNotFound() {
  return (
    <main className="mx-auto max-w-[1200px] px-6 py-16">
      <div className="text-center">
        <div className="mb-8">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <span className="text-2xl font-bold text-slate-500">404</span>
          </div>
          <h1 className="mb-4 text-3xl font-bold text-[var(--text)]">Event Not Found</h1>
          <p className="text-[var(--text-muted)] max-w-md mx-auto">
            The event you&apos;re looking for doesn&apos;t exist or may have been removed.
          </p>
        </div>
        
        <Link 
          href="/credit/events"
          className="btn btn-primary inline-flex items-center gap-2"
        >
          <ArrowLeft size={16} />
          Back to Credit Events
        </Link>
      </div>
    </main>
  );
}
