# Credit Rating article search

Sign in and open `/credit/articles`. The default view includes all dates and
regions, newest first. Type two or more characters for up to six suggestions;
use the arrow keys to pick one or press Enter to see all results. Region,
sector, source, and inclusive date filters apply to both. Opening an article
and choosing its back link restores the search.

The search uses the Credit database only. It matches all query terms against
stored titles, summaries, matched keywords, and source names. Signed ratings
are distinct: `AA+` does not match `AA-` or `AAA+`. Search is literal, not
typo-tolerant. It does not fetch linked articles or call a model. No new
database migration or credentials are required.

The authenticated endpoint is `GET /api/credit/articles/search`. Its parameters
are `q`, `region`, `sector`, `source`, `from`, `to`, `sort`, `page`, and
`suggest=1`. Full results have 15 items per page. The old Credit date-filter
links still work.

## Local verification

Run `pnpm dev` for manual testing. The Credit unit, route, and page tests need
no application database:

```powershell
pnpm -C apps/web exec vitest run src/lib/credit-article-search src/app/api/credit/articles/search src/app/credit/articles/page.test.ts
pnpm -C apps/web exec playwright test --config playwright.article-search.config.ts
```

The browser suite tests both archive search components against mocked responses.
The separate opt-in repository test uses only a **disposable** migrated Credit
database named `credit_article_search_test` on loopback port 55472. Set
`RUN_CREDIT_ARTICLE_SEARCH_DB_TESTS=1` only after provisioning that fixture;
do not point it at an application database.
