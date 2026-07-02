import TenderMonitorDetailPage from "@/components/monitored-tenders/TenderMonitorDetailPage";

export const dynamic = "force-dynamic";

export default async function CreditTenderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <TenderMonitorDetailPage
      id={id}
      domain="credit"
      basePath="/credit/tenders"
    />
  );
}
