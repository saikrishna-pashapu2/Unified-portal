import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-4 py-12">
      <section className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
        <h1 className="text-3xl font-bold text-gray-900">Privacy Policy</h1>
        <div className="mt-6 space-y-4 text-sm leading-6 text-gray-700">
          <p>
            The portal stores account details, activity records, alert
            preferences, uploaded files, and generated outputs needed to provide
            ESG and credit workflows.
          </p>
          <p>
            Uploaded files and generated data are processed for the requested
            portal task. Access is limited to authenticated users and authorized
            administrators.
          </p>
          <p>
            Contact your portal administrator for account access, retention, or
            deletion requests.
          </p>
        </div>
        <div className="mt-8">
          <Link
            href="/register"
            className="inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Back to registration
          </Link>
        </div>
      </section>
    </main>
  );
}
