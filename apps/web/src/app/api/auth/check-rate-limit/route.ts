import { NextRequest, NextResponse } from 'next/server';
import { checkLoginRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * API endpoint to check rate limit status before login attempt
 * This allows the frontend to show remaining attempts
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const rateLimitCheck = checkLoginRateLimit(email);

    return NextResponse.json({
      allowed: rateLimitCheck.allowed,
      remainingAttempts: rateLimitCheck.remainingAttempts ?? 0,
      resetTime: rateLimitCheck.resetTime?.toISOString() ?? null,
    });
  } catch (error) {
    console.error('[Rate Limit Check] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
