import { getHomeArticles, getFreshCount, getRecentSources } from "@/lib/home";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import CreditHome from "@/components/home/CreditHome";

export const revalidate = 0;

export default async function CreditHomePage() {
  const domain = "credit";
  const session = await getServerSession(authOptions);

  // fetch data for the dashboard
  const [freshCount, activeSources, articles] = await Promise.all([
    getFreshCount(domain),
    getRecentSources(domain),
    getHomeArticles(domain, 6),
  ]);

  return (
    <CreditHome
      articles={articles}
      freshCount={freshCount}
      activeSources={activeSources}
      session={session}
    />
  );
}
