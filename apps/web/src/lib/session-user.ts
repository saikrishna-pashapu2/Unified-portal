import "server-only";

import { getServerSession } from "next-auth";
import { findUserAuthStateById } from "@/lib/auth-db";
import { authOptions } from "@/lib/nextauth-options";

// Resolve only an existing, active local account. A stale JWT must never
// recreate a user that an administrator intentionally deleted.
export async function ensureUserId(): Promise<number | null> {
  const session = await getServerSession(authOptions);
  const userId = Number((session?.user as { id?: string } | undefined)?.id);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return null;
  }

  try {
    const user = await findUserAuthStateById(userId);
    return user?.is_active_db ? user.id : null;
  } catch (error) {
    console.error("Error validating authenticated user:", error);
    return null;
  }
}
