# Private article picks and weekly email

The ESG and Credit article pages offer independent, opt-in AI selection for the
signed-in user's weekly email. AI selections are private application records;
they do not increment ordinary likes or enter Community rankings/reports. A
user's explicit **Keep & like** action creates an ordinary human like and can
then contribute to the existing team selection.

## Delivery contract

The canonical article-email implementation is
`apps/web/src/lib/alerts/article-weekly.ts`. The generic worker checks it once
per minute. Both `/api/cron/process-alerts` and the compatibility
`/api/cron/weekly-digest` entrypoint call that same service. The latter no longer
implements a separate all-users digest. The Community report's
`/api/cron/generate-digest` and the ESG events email digest remain separate.

An active weekly alert controls delivery: recipient, enabled content types,
domains, source/keyword filters, weekday, hour, and IANA timezone. Domain lists
are validated; an empty list falls back to the valid legacy `domain` field.
Midnight is a valid hour. A due window belongs to the current local Monday–Sunday
calendar week; a restart can catch up within that week, without replaying missed
months. Alerts created after that week's scheduled time begin the following week.

Each logical email uses `article-weekly:<alert-id>:<local-week-start>` as its
permanent delivery key. Model/template versions are metadata, not delivery
identities. History, queued email, and last-queued marker are committed in one
transaction. The existing standalone SMTP worker delivers the immutable email
snapshot and records actual delivery status. SMTP itself cannot guarantee
exactly-once delivery after an ambiguous provider/network failure; queue retries
retain the existing stable Message-ID.

The email combines human-liked content from the recipient's team with a separate
**AI picks for you** section. An unassigned user uses their own human likes rather
than an all-users group. AI items belong only to the recipient, must be in an
enabled AI domain also selected by the alert, and are capped at five per domain.
An override address or distribution list receives human selections only. Private
picks are eligible only when the destination is the owner's single account email.
The AI switch never creates an email subscription or changes a destination.

Items carry `(domain, content type, id)` in delivery metadata because integer IDs
can overlap between databases. Repeated IDs and canonical article URLs are
deduplicated, with human selections taking priority. Titles, sources, and AI
explanations are HTML-escaped; only HTTP(S) article links are rendered.

If AI results are unavailable, the weekly human digest can still be assembled.
An empty selection never queues an email or records a successful delivery.
If Credit content is unavailable, a combined ESG/Credit email can send available
ESG content with an explicit notice. That counts as that week's delivery; missing
Credit content does not trigger a second email later in the week. A Credit-only
email, or an otherwise empty partial digest, stays due for retry.

## Selection and feedback

Application-owned AI preferences, versioned profiles, cached article features,
bounded run/budget records, selections, and feedback are stored in ESG. The ESG
user directory supplies identity for both domains. Article reads and confirmed
human likes use the corresponding ESG/Credit client. The Credit migration also
records the previously untracked `likes` table contract; it does not replace
production likes or add a foreign key to Credit's separate user directory.

Only historical human likes and explicit feedback are evidence. Absence of a
like is unknown. AI choices never become positive training examples on their
own. At least 20 usable individual examples are needed for a personal profile;
otherwise, at least five usable, distinct articles from same-team, same-domain
human history are needed. With insufficient evidence, the system abstains.
Existing older examples seed the initial profiles
because the current history is sparse.

The worker processes separate `article_ai_esg_v1` and `article_ai_credit_v1`
queues. Credit work remains unclaimed when Credit is unavailable; ESG work can
continue. Expired daily jobs are skipped on recovery, so old budget dates cannot
fund a burst of provider calls. Daily work is idempotent, bounded, and checks opt-in/settings versions
and the worker lease before provider requests and before publishing selections.
New candidates are limited to the last 14 days. Existing selections and dismissal
tombstones are excluded from future passes. Article text is untrusted data. The
model gets bounded candidates and history, has no tools, and must return validated
decisions for known candidate IDs. A conservative UTF-8 input bound plus the
maximum output allowance is reserved before each request; automatic SDK retries
are disabled so they cannot bypass the durable daily budget.

Dismissals persist so the same article is not automatically reselected. Feedback
uses a selection version to prevent contradictory concurrent changes. ESG
confirmation can commit locally; Credit confirmation uses a durable pending
operation and retry-safe Credit insertion before the selection is marked
confirmed. Retrying confirmation does not refresh an existing human like's date.

Turning selection off prevents subsequent generation/commit and excludes AI from
emails assembled after the change. Preferences and feedback are checked again
under locks when the email snapshot is committed. Emails already prepared retain
their contents. Previously confirmed human likes remain ordinary human feedback.

## Deployment and pilot

Deploy both database migrations and regenerate Prisma clients before restarting
web and worker. Use `pnpm db:migrate:deploy` with the separate migration credentials
described in `MIGRATIONS.md` and `DATABASE_ROLES.md`. Never use `db push` on shared
databases. All feature switches default to off:

```dotenv
ARTICLE_WEEKLY_DIGEST_ENABLED=false
ARTICLE_AI_ENABLED=false
ARTICLE_AI_EMAIL_ENABLED=false
ARTICLE_AI_MODEL=gpt-5.6-luna
ARTICLE_AI_MAX_CANDIDATES=40
ARTICLE_AI_DAILY_REQUEST_LIMIT=2
ARTICLE_AI_DAILY_TOKEN_LIMIT=12000
ARTICLE_AI_SELECTION_TTL_DAYS=8
ARTICLE_AI_MAX_HISTORY_EXAMPLES=50
```

Use the existing `OPENAI_API_KEY` and optional `OPENAI_ORG_ID`. Model requests run
only in the background worker, never on a settings read or page render.

1. Apply the additive migrations and verify both schemas on disposable databases.
2. Restart web/worker with AI generation enabled but AI email inclusion disabled.
   Selected users can opt in and review private badges on the articles page.
3. Have the historical curators label a sample of selected and unselected articles
   in each domain. Measure useful selections, repeated stories, and important
   omissions; untouched articles are not negative examples. Review ESG's profile
   carefully because its initial recorded likes came from one contributor.
4. Tune limits/selection policy from that review. Do not equate the model's score
   with a measured probability. The repository tests validate behavior, not live
   recommendation usefulness.
5. Enable weekly article delivery and then AI email inclusion for the approved
   pilot. Per-user/domain opt-in and existing email settings still apply.

Disabling `ARTICLE_AI_EMAIL_ENABLED` pauses AI inclusion while preserving human
email. Disabling `ARTICLE_AI_ENABLED` also stops selection jobs. Disabling
`ARTICLE_WEEKLY_DIGEST_ENABLED` stops creation of weekly article emails; already
queued mail remains under the email queue's delivery lifecycle. These switches
do not require enabling the older in-process scheduler.

## Validation

Run the article AI and weekly-email unit/route suites, `pnpm type-check`,
`pnpm lint`, `pnpm -C apps/web worker:check`, and `pnpm build`. Use
`RUN_DB_INTEGRATION_TESTS=1` only with explicitly provisioned disposable ESG and
Credit databases. The weekly email integration suite queues fixtures and verifies
recipient isolation and concurrent delivery deduplication; it does not run SMTP.

The isolated article AI Playwright configuration mounts the production controls
against mock endpoints without creating a real user or sending email:

```powershell
pnpm -C apps/web exec playwright test --config playwright.article-ai.config.ts
```
