import { getDigests } from "./actions";
import DigestManager from "./DigestManager";
import { Domain } from "@/lib/db";

export default async function WeeklyDigestPage({
  searchParams,
}: {
  searchParams: { domain?: string; page?: string };
}) {
  const domain = (searchParams.domain as Domain) || "esg";
  const page = Number(searchParams.page) || 1;
  
  const { digests, total, totalPages } = await getDigests(domain, page);

  return (
    <DigestManager
      initialDigests={digests}
      domain={domain}
      total={total}
      totalPages={totalPages}
      currentPage={page}
    />
  );
}
