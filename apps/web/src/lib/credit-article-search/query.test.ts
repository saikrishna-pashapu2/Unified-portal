import { describe, expect, it } from "vitest";
import { creditArticleBackPath, creditArticleSearchParams, parseCreditArticleSearchParams } from "./query";

describe("Credit archive query", () => {
  it("only allows local Credit list back links", () => {
    expect(creditArticleBackPath("/credit/articles?q=AA%2B&page=3")).toBe("/credit/articles?q=AA%2B&page=3");
    expect(creditArticleBackPath("/credit/community")).toBe("/credit/community");
    for (const bad of [undefined, "//example.com", "/esg/articles", "/credit/articles/../admin", "https://example.com"]) {
      expect(creditArticleBackPath(bad)).toBe("/credit/articles");
    }
  });
  it("defaults to all dates, regions and sectors", () => {
    expect(parseCreditArticleSearchParams({})).toMatchObject({
      ok: true, filters: { from: "", to: "", region: "", sector: "", sort: "newest", page: 1 },
    });
  });
  it("does not pin a new search to newest after browsing a section", () => {
    const parsed = parseCreditArticleSearchParams({ region: "CentralAsia", page: "2" });
    if (!parsed.ok) throw Error(parsed.error);
    const link = creditArticleSearchParams(parsed.filters);
    expect(link.has("sort")).toBe(false);
    expect(parseCreditArticleSearchParams(link)).toEqual(parsed);
  });
  it.each([
    [{ date: "2023-05-01" }, "2023-05-01", "2023-05-01"],
    [{ dateFrom: "2023-05-01" }, "2023-05-01", "2023-05-01"],
    [{ from: "2023-05-01" }, "2023-05-01", ""],
    [{ dateTo: "2023-05-01" }, "", "2023-05-01"],
  ] as const)("preserves legacy and open-ended dates: %o", (input, from, to) => {
    expect(parseCreditArticleSearchParams(input)).toMatchObject({ok:true, filters:{from,to}});
  });
  it("round trips the exact rating, filters, sort and page", () => {
    const result = parseCreditArticleSearchParams({ q:"AA+ outlook", region:"CentralAsia", sector:"banksRACS", source:"Fitch", page:"3" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.error);
    expect(parseCreditArticleSearchParams(new URLSearchParams(creditArticleSearchParams(result.filters).toString()))).toEqual(result);
    expect(result.filters).toMatchObject({q:"AA+ outlook",sort:"relevance"});
  });
  it.each([{region:"ESG"}, {region:"global",sector:"banks"}, {sector:"oops"}, {dateFrom:"2024-02-31"}, {q:"x"}, {page:"1e5"}])("rejects invalid filters %o", (input) => {
    expect(parseCreditArticleSearchParams(input).ok).toBe(false);
  });
});
