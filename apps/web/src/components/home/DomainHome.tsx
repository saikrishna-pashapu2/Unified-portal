import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  FileCheck,
  FileText,
  Languages,
  Leaf,
  Newspaper,
  Search,
  TrendingUp,
  Wrench,
} from "lucide-react";
import type { ArticleRow } from "@/lib/articles";

type Domain = "esg" | "credit";

type HomeSession = {
  user?: {
    name?: string | null;
  } | null;
} | null;

type HomeLink = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

type DomainTheme = {
  title: string;
  description: string;
  snapshotTitle: string;
  snapshotDescription: string;
  primaryHref: string;
  secondaryHref: string;
  secondaryLabel: string;
  accent: string;
  accentText: string;
  accentBg: string;
  accentBorder: string;
  softBg: string;
  icon: LucideIcon;
  workflows: HomeLink[];
};

const domainThemes: Record<Domain, DomainTheme> = {
  esg: {
    title: "ESG intelligence, simplified",
    description:
      "Track sustainability news, events, tenders, publications, and tools from one clear workspace.",
    snapshotTitle: "ESG snapshot",
    snapshotDescription: "Current activity across ESG sources and workflows.",
    primaryHref: "/esg/articles",
    secondaryHref: "/esg/tools",
    secondaryLabel: "Open ESG tools",
    accent: "bg-emerald-700",
    accentText: "text-emerald-700",
    accentBg: "bg-emerald-50",
    accentBorder: "border-emerald-200",
    softBg: "bg-emerald-50/60",
    icon: Leaf,
    workflows: [
      {
        href: "/esg/tools?tool=drivers",
        label: "Driver agent",
        description: "Generate ESG driver packs by country and sector.",
        icon: Search,
      },
      {
        href: "/esg/events",
        label: "Events",
        description: "Upcoming sustainability briefings and forums.",
        icon: CalendarDays,
      },
      {
        href: "/esg/tenders",
        label: "Tenders",
        description: "Procurement opportunities worth monitoring.",
        icon: FileCheck,
      },
      {
        href: "/esg/publications",
        label: "Publications",
        description: "Recent reports and research material.",
        icon: BookOpen,
      },
      {
        href: "/esg/pdfx",
        label: "PDF translation",
        description: "Translate source documents with OCR support.",
        icon: Languages,
      },
    ],
  },
  credit: {
    title: "Credit insight, without clutter",
    description:
      "Monitor credit news, events, tenders, publications, methodologies, and Fitch tools in one focused workspace.",
    snapshotTitle: "Credit snapshot",
    snapshotDescription: "A concise view of credit coverage and analyst tools.",
    primaryHref: "/credit/articles",
    secondaryHref: "/credit/tools",
    secondaryLabel: "Open credit tools",
    accent: "bg-blue-700",
    accentText: "text-blue-700",
    accentBg: "bg-blue-50",
    accentBorder: "border-blue-200",
    softBg: "bg-blue-50/60",
    icon: TrendingUp,
    workflows: [
      {
        href: "/credit/events",
        label: "Events",
        description: "Credit events, earnings calls, and market dates.",
        icon: CalendarDays,
      },
      {
        href: "/credit/tools/fitch",
        label: "Fitch search",
        description: "Find ratings, reports, and issuer documents.",
        icon: Search,
      },
      {
        href: "/credit/tenders",
        label: "Tenders",
        description: "Credit-related procurement opportunities.",
        icon: FileCheck,
      },
      {
        href: "/credit/publications",
        label: "Publications",
        description: "Research and methodology reading list.",
        icon: FileText,
      },
    ],
  },
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatArticleDate(value: string | null) {
  if (!value) return "No date";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

function formatRelativeDate(value: string | null) {
  if (!value) return "Date pending";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date pending";

  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return formatArticleDate(value);
}

function getFirstName(session: HomeSession) {
  const name = session?.user?.name?.trim();
  if (!name) return null;
  return name.split(/\s+/)[0] ?? null;
}

function ArticleRows({
  articles,
  domain,
  theme,
}: {
  articles: ArticleRow[];
  domain: Domain;
  theme: DomainTheme;
}) {
  if (articles.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <Newspaper className="mx-auto h-8 w-8 text-slate-400" />
        <p className="mt-3 text-sm font-medium text-slate-900">No recent articles found.</p>
        <Link
          href={`/${domain}/articles`}
          className={`mt-2 inline-flex items-center gap-1 text-sm font-semibold ${theme.accentText}`}
        >
          View all articles
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
      {articles.map((article) => (
        <Link
          key={article.id}
          href={`/${domain}/articles/${article.id}`}
          className="group grid gap-3 p-4 transition-colors hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_132px]"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              {article.source ? (
                <span className={`font-semibold ${theme.accentText}`}>{article.source}</span>
              ) : (
                <span>Source pending</span>
              )}
              <span>{formatArticleDate(article.published)}</span>
            </div>
            <h3 className="mt-2 line-clamp-2 text-base font-semibold leading-6 text-slate-950 group-hover:underline">
              {article.title || "Untitled article"}
            </h3>
            {article.summary ? (
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">
                {article.summary}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3 text-sm text-slate-500 sm:justify-end sm:text-right">
            <span>{formatRelativeDate(article.published)}</span>
            <ArrowUpRight className="h-4 w-4 text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function DomainHome({
  domain,
  articles,
  freshCount,
  activeSources,
  session,
}: {
  domain: Domain;
  articles: ArticleRow[];
  freshCount: number;
  activeSources: number;
  session: HomeSession;
}) {
  const theme = domainThemes[domain];
  const Icon = theme.icon;
  const firstName = getFirstName(session);
  const latestArticle = articles[0];

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end lg:py-16">
          <div className="max-w-3xl">
            <div className={`mb-7 inline-flex h-12 w-12 items-center justify-center rounded-lg ${theme.accentBg} ${theme.accentText}`}>
              <Icon className="h-6 w-6" />
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold leading-[1.08] text-slate-950 md:text-6xl">
              {theme.title}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
              {theme.description}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href={theme.primaryHref}
                className={`inline-flex h-11 items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold text-white ${theme.accent} transition-opacity hover:opacity-90`}
              >
                Read latest articles
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <Link
                href={theme.secondaryHref}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-900 transition-colors hover:border-slate-400 hover:bg-slate-50"
              >
                {theme.secondaryLabel}
                <Wrench className="h-4 w-4" />
              </Link>
            </div>
            {firstName ? (
              <p className="mt-5 text-sm text-slate-500">
                Welcome back, <span className="font-semibold text-slate-700">{firstName}</span>.
              </p>
            ) : null}
          </div>

          <aside className={`rounded-lg border ${theme.accentBorder} ${theme.softBg} p-5`}>
            <div className="flex items-start justify-between gap-6">
              <div>
                <h2 className="text-base font-semibold text-slate-950">{theme.snapshotTitle}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">{theme.snapshotDescription}</p>
              </div>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white ${theme.accentText}`}>
                <Activity className="h-5 w-5" />
              </div>
            </div>

            <dl className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-white bg-white p-4">
                <dt className="text-xs font-medium uppercase text-slate-500">Fresh articles</dt>
                <dd className="mt-2 text-3xl font-semibold text-slate-950">{formatNumber(freshCount)}</dd>
              </div>
              <div className="rounded-lg border border-white bg-white p-4">
                <dt className="text-xs font-medium uppercase text-slate-500">Active sources</dt>
                <dd className="mt-2 text-3xl font-semibold text-slate-950">{formatNumber(activeSources)}</dd>
              </div>
            </dl>

            <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <BarChart3 className={`h-4 w-4 ${theme.accentText}`} />
                Latest update
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                {latestArticle?.title || "New updates will appear here as soon as sources publish."}
              </p>
            </div>
          </aside>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-12">
        <div>
          <div className="mb-5 flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-950">Latest articles</h2>
              <p className="mt-1 text-sm text-slate-600">
                Recent source updates, ordered for quick scanning.
              </p>
            </div>
            <Link
              href={`/${domain}/articles`}
              className={`inline-flex items-center gap-2 text-sm font-semibold ${theme.accentText}`}
            >
              View all articles
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
          <ArticleRows articles={articles.slice(0, 6)} domain={domain} theme={theme} />
        </div>

        <aside>
          <div className="mb-5 border-b border-slate-200 pb-4">
            <h2 className="text-2xl font-semibold text-slate-950">Workflows</h2>
            <p className="mt-1 text-sm text-slate-600">Open the areas analysts use most.</p>
          </div>

          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {theme.workflows.map((workflow) => {
              const WorkflowIcon = workflow.icon;
              return (
                <Link
                  key={workflow.href}
                  href={workflow.href}
                  className="group flex items-start gap-3 p-4 transition-colors hover:bg-slate-50"
                >
                  <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${theme.accentBg} ${theme.accentText}`}>
                    <WorkflowIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-slate-950">{workflow.label}</span>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-slate-600">
                      {workflow.description}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </aside>
      </section>
    </main>
  );
}
