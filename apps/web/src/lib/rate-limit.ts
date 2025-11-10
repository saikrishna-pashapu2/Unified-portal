/**
 * Rate limiting for login attempts
 * Prevents brute force attacks by limiting failed login attempts
 */

interface RateLimitRecord {
  count: number;
  resetTime: number;
  firstAttempt: number;
}

// In-memory store for login attempts
// In production, consider using Redis for multi-server deployments
const loginAttempts = new Map<string, RateLimitRecord>();

// Configuration
const MAX_ATTEMPTS = 5; // Maximum failed attempts before lockout
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds
const CLEANUP_INTERVAL = 60 * 60 * 1000; // Clean up old records every hour

/**
 * Check if a login attempt should be allowed
 * @param email User email address
 * @returns true if login should be allowed, false if rate limited
 */
export function checkLoginRateLimit(email: string): {
  allowed: boolean;
  remainingAttempts?: number;
  resetTime?: Date;
} {
  const key = email.toLowerCase().trim();
  const now = Date.now();
  const record = loginAttempts.get(key);

  // No previous attempts or lockout period expired
  if (!record || now > record.resetTime) {
    loginAttempts.set(key, {
      count: 1,
      resetTime: now + LOCKOUT_DURATION,
      firstAttempt: now,
    });
    return {
      allowed: true,
      remainingAttempts: MAX_ATTEMPTS - 1,
    };
  }

  // User is locked out
  if (record.count >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      resetTime: new Date(record.resetTime),
    };
  }

  // Increment attempt counter
  record.count++;
  
  return {
    allowed: true,
    remainingAttempts: MAX_ATTEMPTS - record.count,
  };
}

/**
 * Record a failed login attempt (call this when password is wrong)
 * @param email User email address
 */
export function recordFailedAttempt(email: string): {
  remainingAttempts: number;
  isLocked: boolean;
} {
  const key = email.toLowerCase().trim();
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (!record || now > record.resetTime) {
    // Start fresh tracking
    loginAttempts.set(key, {
      count: 1,
      resetTime: now + LOCKOUT_DURATION,
      firstAttempt: now,
    });
    return {
      remainingAttempts: MAX_ATTEMPTS - 1,
      isLocked: false,
    };
  }

  // Increment failed attempts
  record.count++;
  
  const isLocked = record.count >= MAX_ATTEMPTS;
  const remainingAttempts = Math.max(0, MAX_ATTEMPTS - record.count);

  return {
    remainingAttempts,
    isLocked,
  };
}

/**
 * Reset login attempts for a user (call on successful login)
 * @param email User email address
 */
export function resetLoginAttempts(email: string): void {
  const key = email.toLowerCase().trim();
  loginAttempts.delete(key);
}

/**
 * Get current attempt count for a user (for debugging/monitoring)
 * @param email User email address
 */
export function getAttemptCount(email: string): number {
  const key = email.toLowerCase().trim();
  const record = loginAttempts.get(key);
  
  if (!record) return 0;
  
  const now = Date.now();
  if (now > record.resetTime) {
    loginAttempts.delete(key);
    return 0;
  }
  
  return record.count;
}

/**
 * Clean up expired rate limit records
 * Runs automatically on a timer
 */
function cleanupExpiredRecords(): void {
  const now = Date.now();
  const keysToDelete: string[] = [];
  
  loginAttempts.forEach((record, key) => {
    if (now > record.resetTime) {
      keysToDelete.push(key);
    }
  });
  
  keysToDelete.forEach(key => loginAttempts.delete(key));
  
  if (keysToDelete.length > 0) {
    console.log(`[Rate Limit] Cleaned up ${keysToDelete.length} expired records`);
  }
}

// Start cleanup timer (runs every hour)
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredRecords, CLEANUP_INTERVAL);
}

/**
 * Format remaining time until lockout expires
 * @param resetTime Date when lockout expires
 */
export function formatLockoutTime(resetTime: Date): string {
  const now = Date.now();
  const diff = resetTime.getTime() - now;
  
  if (diff <= 0) return '0 minutes';
  
  const minutes = Math.ceil(diff / 60000);
  
  if (minutes < 1) return 'less than 1 minute';
  if (minutes === 1) return '1 minute';
  return `${minutes} minutes`;
}

/**
 * API rate limiting (for general API endpoints)
 */
const apiRateLimits = new Map<string, { count: number; resetTime: number }>();

export function checkApiRateLimit(
  identifier: string, // IP address or user ID
  maxRequests: number = 100,
  windowMs: number = 60000 // 1 minute
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const record = apiRateLimits.get(identifier);

  // No record or window expired
  if (!record || now > record.resetTime) {
    apiRateLimits.set(identifier, {
      count: 1,
      resetTime: now + windowMs,
    });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime: now + windowMs,
    };
  }

  // Limit exceeded
  if (record.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: record.resetTime,
    };
  }

  // Increment counter
  record.count++;
  
  return {
    allowed: true,
    remaining: maxRequests - record.count,
    resetTime: record.resetTime,
  };
}
