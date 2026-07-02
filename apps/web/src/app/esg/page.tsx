import { getHomeArticles, getFreshCount, getRecentSources } from "@/lib/home";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import DomainHome from "@/components/home/DomainHome";

export const revalidate = 0;

export default async function EsgHome() {
  const domain = "esg";
  const session = await getServerSession(authOptions);

  // fetch data for the dashboard
  const [freshCount, activeSources, articles] = await Promise.all([
    getFreshCount(domain),
    getRecentSources(domain),
    getHomeArticles(domain, 6),
  ]);

  return (
    <DomainHome
      domain={domain}
      articles={articles}
      freshCount={freshCount}
      activeSources={activeSources}
      session={session}
    />
  );
}
