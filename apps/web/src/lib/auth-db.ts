import { createHash } from "node:crypto";
import { esgPrisma } from "@esgcredit/db-esg";

// Returns the raw users row (whatever columns exists)
export async function findUserByEmail(email: string) {
  const rows = await esgPrisma.$queryRaw<any[]>`
    SELECT * FROM users
    WHERE lower(email) = lower(${email})
    LIMIT 1;
  `;
  return rows[0] ?? null;
}

export async function findUserAuthStateById(userId: number) {
  return esgPrisma.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      first_name: true,
      last_name: true,
      password_hash: true,
      is_admin: true,
      is_active_db: true,
      team: true,
    },
  });
}

export function passwordAuthVersion(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("base64url");
}

// Backward-compatible entrypoint for routes that have not yet moved to the
// dedicated session helper. The dynamic import avoids a module cycle because
// session-user imports findUserAuthStateById from this module.
export async function ensureUserId(): Promise<number | null> {
  const sessionUser = await import("@/lib/session-user");
  return sessionUser.ensureUserId();
}
