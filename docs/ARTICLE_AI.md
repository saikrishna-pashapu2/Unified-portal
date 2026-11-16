# Shared article assessment and opt-in weekly email

ESG and Credit each have a shared AI assessment learned from articles human users
have liked in that domain. Personal like counts, account-team assignments, and
the recipient's own interests do not determine the assessment. A user with no
likes can view the same shared picks as everyone else in that domain.

The independent, per-user ESG and Credit switches only control AI inclusion in
that user's own weekly email and default to off. AI selections do not increment
ordinary likes or enter Community rankings/reports. An explicit **Keep & like**
action creates an ordinary human like that can inform later shared assessments.
Dismissals remain private to the user and are not negative training examples.

## Delivery contract

The canonical article-email implementation is
`apps/web/src/lib/alerts/article-weekly.ts`. The standalone worker checks it once
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

The article section includes articles liked by any user in the relevant domain
during the weekly window. Recipients need neither personal likes nor a team
assignment. Existing event/publication sections retain their team-scoped rules.
Opted-in users also receive a separate **AI picks for you** section drawn from the
shared domain assessment, with their private dismissals applied. AI items must be
in an enabled AI domain also selected by the alert and are capped at five per domain.
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

Application-owned AI preferences, shared domain assessments, cached article features,
bounded run/budget records, shared selections, and private feedback are stored in ESG. The ESG
user directory supplies identity for both domains. Article reads and confirmed
human likes use the corresponding ESG/Credit client. The Credit migration also
records the previously untracked `likes` table contract; it does not replace
production likes or add a foreign key to Credit's separate user directory.

All recorded human article likes in the domain contribute to the learning pool,
including likes from users with blank/different team assignments or inactive
accounts. Each distinct, resolvable article is counted once. The bounded profile
uses up to 200 representative examples by default; ESG and Credit never share
their history or assessment. Historical examples have no recency cutoff.

There is no personal-like minimum or five-article team gate. At least one usable
human-liked article is necessary to have any evidence. AI choices never become
positive examples on their own; absence of a like and private dismissals are not
negative examples. The model can still abstain when new candidates are weak.

The worker schedules separate `article_ai_esg_v2` and `article_ai_credit_v2`
domain jobs while AI is enabled. A queue's user identifier is only an accounting
foreign key to an existing account; it never supplies learning preferences.
Legacy v1 jobs are drained as retired work without provider requests. Pending
legacy Credit confirmations still finish through their original outbox.

Each domain/day/policy has one durable assessment shared by all recipients.
The assessment owns its lease and provider budget; private email switches do not
create additional assessments. Credit work remains unclaimed when Credit is
unavailable and ESG work continues. Expired daily jobs are skipped on recovery,
so old budget dates cannot fund a burst of provider calls. Lease fencing protects
provider reservations and publishing. New candidates are limited to the last
14 days. Personal dismissals never alter global ranking. Article text is untrusted data. The
model gets bounded candidates and history, has no tools, and must return validated
decisions for known candidate IDs. A conservative UTF-8 input bound plus the
maximum output allowance is reserved before each request; automatic SDK retries
are disabled so they cannot bypass the durable daily budget.

The latest completed ready assessment supplies the shared picks. A new ready
assessment with no selections is authoritative; it does not resurrect earlier
picks. While a newer assessment is running or has failed, unexpired picks from
the previous ready assessment remain available.

Dismissals persist per user/domain/article across assessments. Shared selections
are stored once; a sparse private overlay is written only when a user gives
feedback. Feedback includes the exact shared-selection UUID and private overlay
version to prevent stale or contradictory changes. ESG
confirmation can commit locally; Credit confirmation uses a durable pending
operation and retry-safe Credit insertion before the selection is marked
confirmed. Retrying confirmation does not refresh an existing human like's date.
Retain historical shared assessments/selections: their foreign keys anchor
private dismissal and feedback history, so deleting them would erase that state.

Turning a user's switch off excludes AI from that user's emails assembled after
the change. It does not stop the shared assessment or hide shared picks from
other users. Preferences and private feedback are checked again
under locks when the email snapshot is committed. Emails already prepared retain
their contents. Previously confirmed human likes remain ordinary human feedback.

## Deployment and pilot

Apply all pending migrations for both databases and regenerate Prisma clients before restarting
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
ARTICLE_AI_MAX_HISTORY_EXAMPLES=200
```

Use the existing `OPENAI_API_KEY` and optional `OPENAI_ORG_ID`. Model requests run
only in the background worker, never on a settings read or page render.

1. Apply the additive migrations and verify both schemas on disposable databases.
2. Restart web/worker with AI generation enabled but AI email inclusion disabled.
   Everyone can review shared picks on the articles page; users opt in only for email inclusion.
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
