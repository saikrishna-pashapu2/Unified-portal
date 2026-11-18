import type { CreditRegion, CreditSector } from "@/lib/credit-articles";
import type { ArticleSearchFilters, ArticleSearchResponse, EsgArticleSearchItem } from "@/lib/esg-article-search/types";
export {
  ARTICLE_SEARCH_PAGE_SIZE as CREDIT_ARTICLE_SEARCH_PAGE_SIZE,
  ARTICLE_SEARCH_SUGGEST_PAGE_SIZE as CREDIT_ARTICLE_SEARCH_SUGGEST_PAGE_SIZE,
} from "@/lib/esg-article-search/types";

export interface CreditArticleSearchFilters extends ArticleSearchFilters {
  region: CreditRegion | "";
  sector: CreditSector | "";
}

export interface CreditArticleSearchItem extends EsgArticleSearchItem {
  region: string | null;
  sector: string | null;
}

export interface CreditArticleSearchResponse extends ArticleSearchResponse {
  items: CreditArticleSearchItem[];
}
