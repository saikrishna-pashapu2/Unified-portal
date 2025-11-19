"use server";

import { getPrisma, Domain } from "@/lib/db";
import { generateWeeklyDigest } from "@/lib/digest-agent";
import { revalidatePath } from "next/cache";

export async function getDigests(domain: Domain, page = 1, limit = 10) {
  const prisma = getPrisma(domain);
  const skip = (page - 1) * limit;

  const [digests, total] = await Promise.all([
    prisma.weekly_digest.findMany({
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
    }),
    prisma.weekly_digest.count(),
  ]);

  return {
    digests,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

export async function deleteDigest(domain: Domain, id: number) {
  const prisma = getPrisma(domain);
  await prisma.weekly_digest.delete({
    where: { id },
  });
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
  const prisma = getPrisma(domain);
  const digest = await prisma.weekly_digest.findUnique({ where: { id } });

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
    await prisma.weekly_digest.delete({ where: { id } });

    revalidatePath("/admin/weekly-digest");
    revalidatePath(`/${domain}/community`);
    return { success: true };
  } catch (error) {
    console.error("Error regenerating digest:", error);
    return { success: false, error: "Failed to regenerate digest" };
  }
}
