import { redirect } from "next/navigation";

export default function TendersTool({
  domain,
}: {
  domain: 'esg' | 'credit';
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  return redirect(domain === "credit" ? "/credit/tenders" : "/esg/tenders");
}
