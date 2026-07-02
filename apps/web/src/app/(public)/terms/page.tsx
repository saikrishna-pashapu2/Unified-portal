import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-4 py-12">
      <section className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
        <h1 className="text-3xl font-bold text-gray-900">Terms of Service</h1>
        <div className="mt-6 space-y-4 text-sm leading-6 text-gray-700">
          <p>
            ESG Credit Portal is an internal information and workflow tool. Use
            the portal only for authorized business purposes and in accordance
            with your organization policies.
          </p>
          <p>
            Do not upload data you are not authorized to process, share account
            access, or use exported files outside approved business workflows.
          </p>
          <p>
            Portal content, ratings, tenders, summaries, and generated outputs
            are provided for internal review and should be validated before
            being used in formal decisions or external communications.
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
