import { redirect } from "next/navigation";

export default function CreditTendersTool({
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  return redirect("/credit/tenders");
}
