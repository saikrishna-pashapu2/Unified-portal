import TenderMonitorListPage from "@/components/monitored-tenders/TenderMonitorListPage";

export const dynamic = "force-dynamic";

export default async function TendersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  return (
    <TenderMonitorListPage
      domain="esg"
      basePath="/esg/tenders"
      searchParams={resolvedSearchParams}
    />
  );
}
