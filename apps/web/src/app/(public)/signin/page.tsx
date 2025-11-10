"use client";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

// Force dynamic rendering
export const dynamic = 'force-dynamic';

function SignInForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const callbackUrl = sp.get("callbackUrl");
  const [error, setError] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setRemainingAttempts(null);
    setIsLoading(true);
    
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email"));
    const password = String(fd.get("password"));
    
    const res = await signIn("credentials", { email, password, redirect: false });
    
    if (res?.ok) {
      // Fetch the session to get user's team
      const sessionRes = await fetch('/api/auth/session');
      const session = await sessionRes.json();
      
      // Redirect to user's team portal or callbackUrl
      const userTeam = session?.team || 'esg';
      const redirectUrl = callbackUrl || `/${userTeam}`;
      router.push(redirectUrl);
    } else {
      // Parse error message from NextAuth
      const errorMessage = res?.error || "Invalid email or password. Please try again.";
      
      // Extract remaining attempts from error message
      // Format: "Invalid email or password. X attempt(s) remaining."
      const attemptsMatch = errorMessage.match(/(\d+) attempt(?:s?) remaining/);
      if (attemptsMatch) {
        const remaining = parseInt(attemptsMatch[1]);
        setRemainingAttempts(remaining);
        setError(errorMessage);
      } else if (errorMessage.includes("Too many failed login attempts")) {
        // User is locked out
        setRemainingAttempts(0);
        setError(errorMessage);
      } else {
        // Generic error
        setError(errorMessage);
      }
      
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Welcome Back</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Sign in to your account to continue</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-8">
          <form onSubmit={onSubmit} className="space-y-6">
            {/* Error Message */}
            {error && (
              <div className={`${
                remainingAttempts === 0 
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' 
                  : remainingAttempts !== null && remainingAttempts <= 2
                  ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
                  : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
              } border rounded-lg p-4`}>
                <div className="flex items-start">
                  <svg className={`w-5 h-5 mr-3 mt-0.5 flex-shrink-0 ${
                    remainingAttempts === 0 
                      ? 'text-red-500' 
                      : remainingAttempts !== null && remainingAttempts <= 2 
                      ? 'text-yellow-500' 
                      : 'text-red-500'
                  }`} fill="currentColor" viewBox="0 0 20 20">
                    {remainingAttempts === 0 ? (
                      // Lock icon for locked out
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    ) : remainingAttempts !== null && remainingAttempts <= 2 ? (
                      // Warning icon for low attempts
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    ) : (
                      // X icon for general error
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    )}
                  </svg>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${
                      remainingAttempts === 0 
                        ? 'text-red-800 dark:text-red-200'
                        : remainingAttempts !== null && remainingAttempts <= 2 
                        ? 'text-yellow-800 dark:text-yellow-200'
                        : 'text-red-800 dark:text-red-200'
                    }`}>
                      {error}
                    </p>
                    {remainingAttempts === 0 && (
                      <p className="text-xs text-red-700 dark:text-red-300 mt-1.5">
                        🔒 Your account has been temporarily locked for security. Please wait before trying again.
                      </p>
                    )}
                    {remainingAttempts !== null && remainingAttempts > 0 && remainingAttempts <= 2 && (
                      <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1.5">
                        ⚠️ Warning: Only {remainingAttempts} more {remainingAttempts === 1 ? 'attempt' : 'attempts'} before temporary lockout.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                placeholder="you@example.com"
              />
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                placeholder="••••••••"
              />
            </div>

            {/* Remember & Forgot */}
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  className="h-4 w-4 text-emerald-600 focus:ring-emerald-500 border-gray-300 rounded"
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
                  Remember me
                </label>
              </div>
              <div className="text-sm">
                <a href="#" className="font-medium text-emerald-600 hover:text-emerald-500 transition-colors">
                  Forgot password?
                </a>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center px-4 py-3 rounded-lg text-white font-semibold bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/30"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        {/* Sign Up Link */}
        <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
          Don&apos;t have an account?{' '}
          <a href="/register" className="font-semibold text-emerald-600 hover:text-emerald-500 transition-colors">
            Create one now
          </a>
        </p>
      </div>
    </div>
  );
}

export default function SignIn() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-emerald-600 border-r-transparent"></div>
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    }>
      <SignInForm />
    </Suspense>
  );
}