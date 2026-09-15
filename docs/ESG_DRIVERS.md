# ESG driver workbook workflow

The ESG Domain Tools page uses `apps/web/data/esg-drivers/ESG_Drivers_September.xlsx`.
Its five sector worksheets contain 685 named rows. A run selects every global row
and every row for the chosen country, preserving the workbook's order, names,
section/country labels, and driver types. UAE / Banking assesses 52 candidates.
New reports publish up to 15 source-supported drivers in relevance order; the
complete candidate assessment remains available in the audit/export.
English, Russian, and Arabic are supported for the updated narrative; canonical
names and original workbook text retain their original spelling and language.

## Workbook import

Columns A–I define section/country, type, name, logic, evidence/KPI, key sources,
and links. Blank category cells continue the preceding category. A new country
resets the type. Literal URLs and embedded hyperlink targets in source columns
are imported with their cell locations. Baseline logic and KPIs are retained as
unverified reference data, never substituted for retrieved evidence.

After updating the workbook in the repository, run:

```powershell
pnpm -C apps/web catalog:generate
pnpm -C apps/web catalog:check
```

Commit the workbook and both generated JSON files together. CI checks that the
generated catalog matches the workbook. The compact options file supplies the
country/sector choices and counts to the UI. Jobs snapshot the selection and
allowlist at creation, so a subsequent workbook release cannot change a retry.
The old catalog and harness remain for legacy compatibility; the active generator
does not select or research through them.

## Restricted research and verification

`search_excel_sources` searches retrieved text from the selected worksheet's URLs.
The same exact allowlist is enforced before initial requests, before every
redirect hop, and when creating final citations. A same-domain URL is not
automatically permitted. URL fragments may identify a location in the same
document; paths and query strings stay restricted. Standard SSRF controls,
public-IP resolution, pinned connections, content-type checks, response-size
limits, manual redirects, and timeouts remain enabled.

HTML extraction retains tables and short cells. PDF extraction searches all
pages up to explicit limits of 500 pages and 500,000 text characters per source;
oversize or unreadable sources produce an explicit failure. Direct fetching does
not execute JavaScript or OCR image-only documents. An optional Tavily Extract
fallback uses the existing `TAVILY_API_KEY` for browser challenges, transient HTTP
failures and unreadable pages. It requests the full text of one exact workbook
URL without a search query, crawl, link discovery or generated answer. Returned
source URLs must match that requested URL. Public-address checks, text/response
limits and a bounded timeout also apply to the fallback; an unlisted redirect
or a policy/size violation cannot trigger it. Direct requests validate each
redirect hop; the external extraction service supplies a source URL rather than
a hop-by-hop network trace. The recorded retrieval method distinguishes these
paths. Requests are cached within a run.
Relevant passages, their locations and source identities are passed to the
writer. Dates used in claims must be present in those passages. No search-engine
snippets, newly discovered URLs, or workbook baseline
claims can establish source support. A different report URL must be added to
the workbook before the agent may open it.

The model cannot change names, categories, candidate identities or citation URLs.
Application code owns candidate order and final report selection.
Verbatim quotations must match retrieved passages; every numeric token in the
draft must occur in its cited evidence. A separate structured model review checks
direct substantive evidence for the exact named driver, meaning, language, claim support, units, geography, period, target-versus-outcome
status, and the newest relevant facts in the supplied passages. Two repair attempts
are permitted, with the rejected draft and concise corrections. These checks establish support within the retrieved evidence; they
do not guarantee that a permitted page contains the world's newest information.
Historical reports must be attributed to their reporting period. A dated
announcement cannot prove that scrutiny, implementation or institutional status
remains unchanged today; retrieval and HTTP modification dates do not establish
legal status. Recommendations must not be strengthened into obligations.
No synthetic confidence/authority/freshness percentage is displayed for new runs.

The reviewer sees only the passages actually cited by the draft. A passing
reference or adjacent ESG discussion cannot substantiate a named framework,
decision or empirical relationship. For example, generic climate-finance text
does not verify COP29 decisions. The search prioritizes each row's own URLs and
checks named framework identities. Workbook KPIs are excluded from the writer's
prompt; the original logic is provided only as an unverified scope brief.

A separate editorial review sees all retrieved candidate passages to detect
omitted newer amendments, missing scope clauses, weak country evidence, mixed-up
bank/borrower roles and unrelated regulatory filler. It cannot approve an
unsupported factual claim: a required new passage must be cited by the repaired
draft and then pass the citation-only verifier. Both reviews must pass. Selection
reserves relevant opening/cover text, updates and applicability context from each driver's own URLs,
prioritizes country evidence and supplies up to 16 passages (six per source).
Analyst-proposed monitoring KPIs are rejected even when labelled as suggestions;
source-established qualitative criteria, requirements and dated milestones are
valid evidence. Country-specific hazards/market facts require country evidence,
while global frameworks can have clearly framed country/sector implications.
Numbered PRI mappings require a cited, permitted PRI source; attributing a
secondary description to CDP does not bypass that check. Without primary support,
the draft must keep supported PRI policy/reporting roles and omit the mapping.
Retained rows with that defect are regenerated on retry.
Old NZBA progress-report evidence must use a historical/unresolved-status label
and historical wording for institutional and membership claims. Retained rows
that incorrectly assert present status are also regenerated on retry.
The writer and both reviewers preserve commitments as commitments: a pledge to
align portfolios cannot become a claim that portfolios were aligned. Measured
target-setting counts are separate from achieved emissions or alignment outcomes.
Original framework adoption is labelled `framework-reference`, even when its
adoption date is known; `dated-update` requires a subsequent substantive development.

New checkpoints record the `2026-09-editorial-v2` quality policy. Their supported
rows require the editorial provenance and evidence classification at completion.
Older saved results remain readable under their original policy, but a retry
upgrades older supported rows through the current reviews instead of inheriting
their old acceptance flags. The writer/reviewers remain `gpt-5.6-luna`: low
reasoning for the first draft, medium for the first repair and both reviews,
and high for the final repair. The final repair starts afresh from the evidence
and corrections, without receiving the rejected draft's unsupported text.

Every candidate row ends as `verified` (displayed as **Source supported**) or
`unavailable`. Unavailable rows keep their identity and baseline, but do not
present an invented update or KPI. Partial packs remain viewable and exportable.
Exports contain Summary, Drivers, Citations, and Sources sheets. The Sources
sheet uses bounded previews; the Citations sheet retains the full supporting
quotations used for each driver. Publication/update dates and HTTP modification
dates are distinguished from retrieval time.
New runs also include a Source availability sheet listing the exact workbook
URLs, retrieval status and access failures. Browser verification pages are
rejected as unavailable evidence; the agent does not follow their scripts.
The page and Drivers export distinguish dated updates, standing framework
references, historical evidence and unresolved current status, with the relevant
evidence date/period and a material limitation. Sources retain document titles,
separate publication/update/HTTP/retrieval dates, and dates stated in the source
text with their surrounding context. A mentioned event/effective date is not
silently promoted to the source's publication date.

## Relevance selection and source dates

New checkpoints carry `selectionPolicy: relevance-top15-v1`. Each supported
candidate receives four anchored integer ratings from 0 to 5: country fit
(30 points), sector fit (30), business impact (25), and obligation/urgency (15).
The application computes each contribution as `rating * weight / 5`. The model
must explain each rating and reference the driver's verified citation passages;
it cannot supply an unchecked final percentage. Relevance is a prioritization
judgment, not a confidence or probability score. Scoring uses country, sector,
canonical workbook identity and evidence, excluding output language and translated
narrative. Translations change explanations only. The assessment stores its model,
response ID, policy version and an evidence fingerprint for checkpoint reuse.
Assessment revision `driver-specific-v2` also requires a separate evidence review
of the proposed ratings. It checks exact-driver support, proportional ratings,
driver-specific urgency and the absence of borrowed obligations. A background
mention in another regulation cannot transfer that regulation's duties or
deadlines to the named framework. Rejected ratings receive bounded repair;
unreviewed assessments cannot be selected or reused.
If both evidence reviews reject a score, the verified driver content and cited
sources remain in the candidate audit with an explicit `relevanceFailure`
record and rejection reasons. The candidate is excluded as `unscored`, without
publishing its rejected number or stopping other candidates. Provider failures
and malformed responses still follow the normal durable job error handling.

Only supported candidates scoring at least 50 qualify. Scores of 80 or more are
labelled High; 50–79 Medium. Ties use workbook row then ID. Clear alternate
legacy/reference names of the same driver are suppressed; distinct related
frameworks are not merged. There are no fixed country/global or ESG category
quotas. Selection returns up to 15 and never fills gaps with unsupported rows.
The full pool stays in workbook order in `candidatePool`; `drivers` contains only
the saved ranked report. Selection records every exclusion and its reason.
Completion means 15 published drivers; missing candidate evidence remains visible
and retryable even when that target is met. Below-threshold and below-cutoff rows
are not research failures. Existing saved full-workbook results retain their
original display/export contract; new retry children use the ranked policy.

The UI preserves saved rank across views and shows score, rationale and weighted
breakdown. The Drivers export follows the same ranked order, with the complete
pool on a separate audit sheet. Source dates use `sourceDate` with the date value,
kind (published, updated or version-issued), original evidence and location.
Only the page/document's own publication or version context can establish this
field; unrelated dates mentioned in the body cannot. Unknown dates stay unknown,
and month/year precision is preserved. Source dates remain separate from the
driver's evidence period, legal effective dates, HTTP metadata and retrieval time.
Saved ranked reports validate date syntax and reject future document dates. Their
document-date evidence, publication/update metadata and HTTP modification fields
must match the durably retrieved checkpoint source; merging passages cannot
replace that provenance. The candidate audit includes exact workbook identities
and baselines, generated content, score reasons, source links and coverage gaps.

## Durability and operations

Each completed row is saved as a version-2 checkpoint through the existing queue
lease and cancellation fences. Provider errors propagate to queue retry handling.
Transient Prisma connectivity errors (including P1001) also retry the durable
job from its checkpoint; raw database writes are not blindly replayed.
Internal audits can create an immutable child that rechecks selected workbook
rows while retaining the other statuses. The public retry action retries
unavailable updates and rejected relevance assessments. Retained supported rows require the same complete
source-document version and revalidated quotations before reuse. A changed
document triggers regeneration even if its previous quotation still appears.
Source-wide date metadata remains available in the audit/export, but is not fed
to the writer or reviewers as claim support: their dates must come from supplied
passages and be cited. Global framework updates are reviewed for substantive
changes to that framework, not forced additions of adjacent local background.
The writer selects the main evidence date from written dates/years in those
passages (or null). The main date/status does not combine every background
citation's date. Version 2 also keeps passing-review commentary out of repair
instructions. Retrying a version 1 evaluation upgrades and regenerates its rows.
Maintained rulebook entries are distinguished from dated reports: an explicit
`Status: In-Force` field is reported as the entry's displayed status, not limited
to its issuance date. It does not establish enforcement, individual-bank
compliance, measured outcomes or the absence of later amendments.
For a permitted PDF that directly supports a row, passage selection retains its
cover alongside topic-specific evidence, so report dates remain citable even
when the report title differs from the individual driver (for example, the NDC
report supporting Water scarcity).
A retry reuses completed rows; a manual partial-pack retry creates an immutable
child, rechecks supported rows against their saved source versions and quotations, and retries
unavailable rows and relevance assessment gaps. Results from the older catalog remain readable/exportable, but
legacy checkpoints cannot resume into this restricted workflow. Start a new run
for those packs. No database migration is required for the JSON checkpoint format.
New jobs use `esg_driver_excel_v4`, which older workers do not claim. General
workers also support older queue versions. Before
completion, the domain transaction checks the result against the saved workbook
rows, allowlist, citations, model review records and relevance evidence fingerprints.
It recomputes selection and requires the exact saved candidate pool and ranked
drivers. Checkpoint updates cannot replace the pinned workbook selection,
selection policy or allowlist. JSONB values are compared
independently of object-key ordering. Invalid saved workbook results are blocked
on reads and exports instead of being silently treated as legacy packs.

Deploy the web and worker code together and restart the worker to use the new
generator. No Google CSE key is needed. The existing `OPENAI_API_KEY` and optional
`OPENAI_ESG_DRIVERS_MODEL` configure generation. The default is `gpt-5.6-luna`
for both writing and verification, with low reasoning for the first draft,
medium for the first repair and reviews, and high for the final repair. The provider's returned model and response ID are
recorded for both stages of each supported driver. Avoid switching a worker binary while it is actively
processing a job; allow it to stop gracefully first.
Refresh every local worker that can claim `esg_driver_excel_v4`, including a
general worker started by another terminal. Restarting only the ESG-only process
does not prevent an older general worker from claiming new jobs. Worker logs
record the job ID, claiming process identity and quality policy for new ESG jobs.
Creating a retry keeps the parent read, checkpoint copy and child queue entry in
one transaction, with a bounded 30-second timeout for evidence-rich checkpoints.
Final completion uses the same bounded timeout while verifying and atomically
storing the full candidate pool, evidence and queue result. Expired database
transactions can retry from the durable checkpoint.

For local ESG work, run `pnpm dev` alongside `pnpm worker:esg-drivers`. This
worker mode processes only the new ESG Drivers queue and does not run email,
maintenance or unrelated document jobs.

## Validation

```powershell
pnpm -C apps/web exec vitest run src/lib/esg-drivers src/app/api/esg/drivers src/app/esg/tools/__tests__/drivers-client.test.ts
pnpm type-check
pnpm -C apps/web exec playwright test --config playwright.esg-drivers.config.ts
```

The isolated browser configuration renders the actual client with mocked APIs and
a test router. It does not create a user, contact the database, or call the model.
The regular Playwright configuration uses the existing authentication/DB fixture
and should run only against a dedicated test database.
