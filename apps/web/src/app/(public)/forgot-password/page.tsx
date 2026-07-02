import Link from "next/link";

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-4 py-12">
      <section className="mx-auto max-w-xl rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
        <h1 className="text-3xl font-bold text-gray-900">Password Help</h1>
        <p className="mt-3 text-gray-600">
          Password resets are handled by the portal administrator. Contact your
          ESG Credit Portal admin with the email address on your account.
        </p>
        <div className="mt-8">
          <Link
            href="/signin"
            className="inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Back to sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
