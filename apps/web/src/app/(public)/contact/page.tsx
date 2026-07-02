import Link from "next/link";

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-4 py-12">
      <section className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
        <h1 className="text-3xl font-bold text-gray-900">Contact Support</h1>
        <div className="mt-6 space-y-4 text-sm leading-6 text-gray-700">
          <p>
            For portal access, account recovery, file-processing issues, or ESG
            and credit workflow support, contact your portal administrator.
          </p>
          <p>
            Include the page URL, the action you were taking, and any request or
            upload reference shown in the portal so support can trace the issue.
          </p>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/signin"
            className="inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Back to sign in
          </Link>
          <Link
            href="/"
            className="inline-flex rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Home
          </Link>
        </div>
      </section>
    </main>
  );
}
