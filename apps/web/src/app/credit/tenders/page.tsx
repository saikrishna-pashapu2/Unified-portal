import TenderMonitorListPage from "@/components/monitored-tenders/TenderMonitorListPage";

export const dynamic = "force-dynamic";

export default async function CreditTendersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  return (
    <TenderMonitorListPage
      domain="credit"
      basePath="/credit/tenders"
      searchParams={resolvedSearchParams}
    />
  );
}
