import React, { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  sources: vi.fn(),
  search: vi.fn(),
  counts: vi.fn(),
  liked: vi.fn(),
  dailyPickIds: vi.fn(),
  searchControl: vi.fn(),
  rowCard: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({ requireUserSession: mocks.auth }));
vi.mock("@/lib/articles", () => ({ fetchCreditSources: mocks.sources }));
vi.mock("@/lib/credit-article-search/repository", () => ({ searchCreditArticles: mocks.search }));
vi.mock("@/lib/likes", () => ({ getLikeCounts: mocks.counts, getUserLikedSet: mocks.liked }));
vi.mock("@/lib/article-ai/daily-feed", () => ({ getDailyArticlePickIds: mocks.dailyPickIds }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children),
}));
vi.mock("@/components/articles/CreditArticleSearch", () => ({
  default: (props: { filters: { q: string }; sources: string[] }) => {
    mocks.searchControl(props);
    return createElement(
      "div",
      { "data-test": "credit-search", "data-sources": props.sources.join("|") },
      props.filters.q || "Credit search",
    );
  },
}));
vi.mock("@/components/articles/CreditArticleRowCard", () => ({
  default: (props: {
    title: string;
    detailHref: string;
    regionLabel: string;
    sectorLabel: string;
  }) => {
    mocks.rowCard(props);
    return createElement(
      "article",
      null,
      createElement("a", { href: props.detailHref }, props.title),
      createElement("span", null, props.regionLabel),
      createElement("span", null, props.sectorLabel),
      createElement("button", null, "Like article"),
      createElement("div", null, "Existing AI selection"),
    );
  },
}));
vi.mock("@/components/articles/CreditArticlesHeader", () => ({
  default: ({ filters, dateLabel, total }: { filters?: ReactNode; dateLabel: string; total: number }) =>
    createElement("header", null, filters, createElement("span", null, dateLabel), createElement("span", null, String(total))),
}));
vi.mock("@/components/articles/ArticleAiProvider", () => ({
  default: ({ children }: { children: ReactNode }) => createElement("div", { "data-test": "ai-provider" }, children),
}));
vi.mock("@/components/articles/ArticleAiControls", () => ({
  default: () => createElement("div", null, "Existing AI controls"),
}));
vi.mock("@/components/articles/ArticleAiOnlyFilter", () => ({
  default: () => createElement("div", null, "AI picks filter"),
}));

import Page from "./page";

const defaultSearchResponse = {
  items: [
    {
      id: 101,
      title: "Credit archive research",
      source: "Archive Journal",
      published: "2024-01-19",
      url: "https://example.test/research",
      snippet: "Research across the full Credit archive.",
      matched_keywords: null,
      region: null,
      sector: null,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 15,
  hasMore: false,
  query: "",
  typoTolerance: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  mocks.auth.mockResolvedValue({ userId: 17, session: { user: { id: "17" } } });
  mocks.sources.mockResolvedValue(["Archive Journal"]);
  mocks.counts.mockResolvedValue({ 101: 2 });
  mocks.liked.mockResolvedValue(new Set([101]));
  mocks.dailyPickIds.mockResolvedValue([101]);
  mocks.search.mockResolvedValue(defaultSearchResponse);
});

describe("Credit article search page", () => {
  it("requires authentication before fetching the archive or source catalog", async () => {
    mocks.auth.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/signin");
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.sources).not.toHaveBeenCalled();
  });

  it("browses the full archive by default and keeps Credit article actions", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    expect(mocks.search).toHaveBeenCalledWith({
      q: "",
      source: "",
      from: "",
      to: "",
      sort: "newest",
      page: 1,
      region: "",
      sector: "",
    });
    expect(html).toContain("Credit archive research");
    expect(html).toContain("Existing AI controls");
    expect(html).toContain("Existing AI selection");
    expect(html).toContain("Like article");
    expect(html).toContain("Region unavailable");
    expect(html).toContain("Sector unavailable");
    expect(mocks.liked).toHaveBeenCalledWith("credit", 17, "article", [101]);
  });

  it("preserves Credit scope and canonical search state in the detail back link", async () => {
    const html = renderToStaticMarkup(
      await Page({
        searchParams: Promise.resolve({
          q: "BBB-",
          source: "Legacy Feed",
          region: "MiddleEast",
          sector: "banks",
          from: "2024-01-01",
          to: "2024-12-31",
          sort: "relevance",
          page: "2",
        }),
      }),
    );

    expect(mocks.search).toHaveBeenCalledWith({
      q: "BBB-",
      source: "Legacy Feed",
      from: "2024-01-01",
      to: "2024-12-31",
      sort: "relevance",
      page: 2,
      region: "MiddleEast",
      sector: "banks",
    });
    expect(html).toContain("back=%2Fcredit%2Farticles%3Fregion%3DMiddleEast");
    expect(html).toContain("%26sector%3Dbanks");
    expect(html).toContain("%26source%3DLegacy%2BFeed");
    expect(html).toContain("%26q%3DBBB-");
    expect(html).toContain("%26from%3D2024-01-01");
    expect(html).toContain("%26to%3D2024-12-31");
    expect(html).toContain("%26sort%3Drelevance");
    expect(html).toContain("%26page%3D2");
    expect(html).not.toContain("dateFrom");
    expect(html).not.toContain("dateTo");
  });

  it("uses the shared daily pick ids for the server-side AI-only filter", async () => {
    await Page({ searchParams: Promise.resolve({ ai: "1", region: "MiddleEast", page: "2" }) });

    expect(mocks.dailyPickIds).toHaveBeenCalledWith("credit");
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({ region: "MiddleEast", page: 2 }),
      { articleIds: [101] },
    );
  });

  it("normalizes legacy dateFrom/dateTo parameters for the full-archive search", async () => {
    await Page({
      searchParams: Promise.resolve({ dateFrom: "2024-04-05" }),
    });

    expect(mocks.search).toHaveBeenCalledWith({
      q: "",
      source: "",
      from: "2024-04-05",
      to: "2024-04-05",
      sort: "newest",
      page: 1,
      region: "",
      sector: "",
    });
  });

  it("renders an empty state separately from a search failure", async () => {
    mocks.search.mockResolvedValueOnce({
      ...defaultSearchResponse,
      items: [],
      total: 0,
    });
    const emptyHtml = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: "climate" }) }));

    expect(emptyHtml).toContain("No articles found for the selected filters.");
    expect(emptyHtml).not.toContain("temporarily unavailable");

    mocks.search.mockRejectedValueOnce(new Error("internal password=test-secret"));
    const errorHtml = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: "climate" }) }));

    expect(errorHtml).toContain("temporarily unavailable");
    expect(errorHtml).not.toContain("No articles found for the selected filters.");
    expect(errorHtml).not.toContain("test-secret");
  });

  it("keeps search usable when the source catalog is unavailable and retains the selected source", async () => {
    mocks.sources.mockRejectedValueOnce(new Error("source database password=test-secret"));
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ q: "climate", source: "Legacy Feed" }) }),
    );

    expect(html).toContain("Source filters are temporarily unavailable");
    expect(html).toContain("Credit archive research");
    expect(mocks.search).toHaveBeenCalled();
    expect(mocks.searchControl).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ["Legacy Feed"] }),
    );
    expect(html).not.toContain("test-secret");
  });

  it("does not run a fallback search for invalid filters", async () => {
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ from: "2024-02-30" }) }),
    );

    expect(mocks.search).not.toHaveBeenCalled();
    expect(html).toContain("Invalid from date");
  });
});
