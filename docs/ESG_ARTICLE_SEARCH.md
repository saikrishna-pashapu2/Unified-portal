# ESG article archive search

The `/esg/articles` page searches the complete `esg_articles` table. It does not
implicitly restrict the archive to today or sample a fixed number of recent
articles. It searches stored titles, summaries, matched keywords, and sources;
it does not crawl linked websites or search a full article body that is absent
from the ESG schema. There are no embedding, LLM, or other paid API calls.

## User behavior

- An empty query browses the archive newest first, 15 articles per page.
- Typing at least two characters requests up to six suggestions after 250 ms.
- Enter searches all results; arrow keys and Enter can open a suggestion, and
  Escape dismisses the list. IME composition does not send unfinished queries.
- A new query defaults to relevance. Users can select newest first instead.
- Source and inclusive date-range filters apply to both suggestions and results.
  Blank dates mean all dates. Old `?date=YYYY-MM-DD` links remain supported.
- **Reset filters** clears the search, source, dates, and sort in one click.
  It returns to the first page of the full archive; Back restores an applied search.
- Query, filters, sort, and pagination are URL state. Article links include a
  back link to the result state. Existing likes and Article AI controls remain.
- Snippets and highlights render plain text, never untrusted article HTML.
- A service failure is distinct from a successful search with zero matches.

## Backend and database

`GET /api/esg/articles/search` accepts `q`, `source`, `from`, `to`, `sort`, `page`,
and `suggest=1`. The route requires the existing authenticated-user guard and
uses private/no-store HTTP responses. Queries are parameterized. The API has a
bounded, per-process, per-user rate limiter; this is not a distributed quota.
Suggestions use a short, bounded process-local cache and coalesce identical
in-flight searches. Failed requests are not cached as empty results.

The query limit is 160 Unicode characters and 12 terms. PostgreSQL statements
have a local timeout and run in read-only transactions. The repository probes
capabilities without creating extensions or indexes at runtime.

The incremental migration
`packages/db-esg/prisma/migrations/20261117140000_esg_article_search/migration.sql`
adds expression indexes, without changing scraper-owned columns:

- weighted full-text GIN: title > summary > keywords > source;
- title trigram GIN for typo tolerance;
- date/id and source/date/id indexes for stable browsing and filtering.

The indexed path uses all query terms, a prefix for the last term, an exact
phrase boost, and date/id tie breaking. Typo matching of the last term does not
discard earlier terms. `GHG` also matches `greenhouse gases`. This is keyword
search, not cross-language semantic search.

An unmigrated database uses weighted, case-insensitive literal/token matching
across the same complete archive, without constructing full-text vectors for
every row or claiming typo tolerance. This compatibility mode is not identical
to the indexed word/prefix matching. Production should still receive the indexes before relying on
search under load. Check the actual environment used by `apps/web`: root and
app `.env` files may point at different databases. Do not print connection
strings, silently change them, or apply migrations to a shared database while
testing locally.

### Migration rollout caution

The migration uses ordinary `CREATE INDEX` in a transaction. These indexes
briefly block writes to `esg_articles` while building, including external
scrapers. Review archive size, extension privileges, and a low-traffic/paused
scraper window before an authorized deployment. For a much larger archive,
plan a separately reviewed concurrent-index rollout instead. Follow
`docs/MIGRATIONS.md` and the dedicated migration roles; do not run `db push` or
`migrate dev` on shared databases. No runtime account needs DDL privileges.

## Local verification

Unit/API/server-page checks (no database required):

```powershell
pnpm -C apps/web exec vitest run src/lib/esg-article-search src/app/api/esg/articles/search/route.test.ts src/app/esg/articles/page.test.ts
pnpm type-check
```

The integration suite is opt-in and rejects non-loopback database targets. For
the dedicated disposable fixture used during implementation, provision an
`esg_articles` table matching the schema and apply the search migration first:

```powershell
$env:RUN_ESG_ARTICLE_SEARCH_DB_TESTS = '1'
$env:ESG_ARTICLE_SEARCH_TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:55471/esg_article_search_test_20261117'
pnpm -C apps/web exec vitest run src/lib/esg-article-search/repository.integration.test.ts
```

Do not substitute the normal application database. Tests insert/remove their
own fixtures and exercise indexed and unindexed capability paths.

Isolated browser checks render the production search component against mocked
API responses. They do **not** use the standard Playwright global user-creation
setup, connect to an application database, or make model calls:

```powershell
pnpm -C apps/web exec playwright test --config playwright.article-search.config.ts
```

If Playwright's bundled Chromium is not installed but system Chrome is available,
set `$env:ARTICLE_SEARCH_BROWSER_CHANNEL = 'chrome'` before the command. Browser
coverage includes debounce, navigation/back state, stale-response dismissal,
IME input, error recovery, mobile sizing, safe text, and axe accessibility.

For manual acceptance, run `pnpm dev`, sign in locally, and open `/esg/articles`.
Try a title fragment, a summary-only term, an older article, a source/date filter,
and page 2 followed by an article's back link. The isolated browser harness is a
test surface, not a replacement for signed-in acceptance of the actual page.
