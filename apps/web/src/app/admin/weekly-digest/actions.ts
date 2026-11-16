"use server";

import type { Domain } from "@/lib/db";
import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";
import { generateWeeklyDigest } from "@/lib/digest-agent";
import { revalidatePath } from "next/cache";

export async function getDigests(domain: Domain, page = 1, limit = 10) {
  const skip = (page - 1) * limit;
  const query = { orderBy: { created_at: "desc" as const }, skip, take: limit };
  // The two databases have distinct nullable timestamp contracts.
  const [digests, total] = domain === "esg"
    ? await Promise.all([esgPrisma.weekly_digest.findMany(query), esgPrisma.weekly_digest.count()])
    : await Promise.all([creditPrisma.weekly_digest.findMany(query), creditPrisma.weekly_digest.count()]);

  return {
    digests,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

async function deleteDigestRecord(domain: Domain, id: number) {
  return domain === "esg"
    ? esgPrisma.weekly_digest.delete({ where: { id } })
    : creditPrisma.weekly_digest.delete({ where: { id } });
}

export async function deleteDigest(domain: Domain, id: number) {
  await deleteDigestRecord(domain, id);
  revalidatePath("/admin/weekly-digest");
  revalidatePath(`/${domain}/community`);
}

export async function triggerDigestGeneration(domain: Domain) {
  try {
    await generateWeeklyDigest(domain);
    revalidatePath("/admin/weekly-digest");
    revalidatePath(`/${domain}/community`);
    return { success: true };
  } catch (error) {
    console.error("Error generating digest:", error);
    return { success: false, error: "Failed to generate digest" };
  }
}

export async function regenerateDigest(domain: Domain, id: number) {
  const digest = domain === "esg"
    ? await esgPrisma.weekly_digest.findUnique({ where: { id } })
    : await creditPrisma.weekly_digest.findUnique({ where: { id } });

  if (!digest) {
    throw new Error("Digest not found");
  }

  // Calculate reference date: The Monday AFTER the digest's week_end
  // generateWeeklyDigest looks for the "previous week" relative to the reference date.
  // So if we pass the Monday immediately following the week_end, it will target that week.
  const weekEnd = new Date(digest.week_end);
  const referenceDate = new Date(weekEnd);
  referenceDate.setDate(weekEnd.getDate() + 1); // Monday

  try {
    await generateWeeklyDigest(domain, referenceDate);
    // Delete the old one to replace it
    await deleteDigestRecord(domain, id);

    revalidatePath("/admin/weekly-digest");
    revalidatePath(`/${domain}/community`);
    return { success: true };
  } catch (error) {
    console.error("Error regenerating digest:", error);
    return { success: false, error: "Failed to regenerate digest" };
  }
}
