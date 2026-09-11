# PDF and Excel translation workspace

The existing `/esg/tools/pdf-translator-2` page now accepts PDF and plain XLSX files. The server checks the file content: PDFs follow the existing PDF pipeline; XLSX workbooks enter a separate inspection/selection workflow. Old XLS, XLSM, encrypted workbooks, embedded files, signed workbooks and external workbook links are not supported.

## Local workflow

1. Start the web app with `pnpm dev` and the generic worker in a second terminal with `pnpm worker`. Restart both after updating code. The generic worker must advertise `xlsx_translation_v1`.
2. Open the existing translator and upload an XLSX workbook. Inspection does not call a model. It creates a private draft in the configured ESG database.
3. Choose worksheets and suggested table regions, or select a whole worksheet. Edit A1 ranges and optional comma-separated column letters (for example `B,D`). Hidden sheets are excluded unless explicitly shown and selected.
4. Leave source language on Auto or provide a hint. Choose Russian, English or Arabic as the target. Review the selected/protected counts and eligible text samples.
5. Confirm to start paid translation. The existing worker translates selected text batches with the existing pinned Luna model. No Sol/Terra fallback is added.
6. Inspect Original, Translated or Compare in the cell-grid preview and download the complete translated XLSX. Unselected sheets and cells remain in the download. Recent history combines PDF and Excel jobs; terminal jobs and drafts can be deleted. Cancel active jobs before deletion.

The existing admin PDF translator dashboard includes a separate Excel usage section. It reports retained-job counts, users, request attempts, input/output tokens, the cached-input subset and changed cells. It does not mix Excel cells with PDF page counts or claim to be a provider billing ledger.

## Translator home and complete history

The home page uses a full-width document library below the upload/language panel. History defaults to 25 records per page, with 10/25/50 page-size options and first/previous/next/last navigation. There is no recent-eight-record visibility cap or date cutoff. Every retained PDF and Excel job belonging to the signed-in user is available across those pages.

Filename search (including Cyrillic and literal percent/underscore characters), PDF/Excel filters, and status tabs apply on the server before pagination. Tab counts cover the whole searched/file-type-filtered collection, while the library badge counts all retained jobs for the owner. Drafts have their own filter. The metadata-only union, counts and ordered page are read in one SQL statement with owner predicates in both branches and parameterized values. Source/output files and checkpoints are never read by history.

Search is debounced; changing filters resets to page one and cancels stale reads. Failed refreshes clearly identify previously loaded results, with an explicit retry. Removing the last document on a page returns to the last remaining page. Deletion still requires confirmation and is disabled for active jobs. These reads and navigation do not start translation, call the model, alter existing jobs, or require a migration.

The responsive layout includes creation dates on mobile, visible status filters, keyboard focus indicators and reduced-motion support. Run the isolated home-page browser test with `node apps/web/scripts/test-translator-home-ui.mjs`; it uses mock APIs and checks complete pagination, search, filters, uploads, deletion, empty/error states and accessibility. Screenshots are saved under `tmp/translator-home-ui`.

## Preservation and limitations

The application reads native worksheet text, not a PDF rendering or OCR of Excel. It edits selected worksheet cell XML in the original package. It does not ask the model to rebuild a workbook. Shared strings remain untouched; selected replacements become literal inline strings. This prevents replacement of unselected cells sharing the same string and prevents formula-looking text from becoming executable formulas.

Downloads are values-only copies: cell formulas on every worksheet (including hidden/unselected sheets) are replaced by their saved results. Selected text results can be translated. Numbers, dates, Booleans, errors, zeroes and explicitly saved empty strings retain their saved types/values and styles. Shared/array formulas are flattened together; calculation chains and native-table calculation definitions are removed so formulas are not restored by that metadata. Original uploads remain untouched. Formatting rules, drawings, sheet order, merged ranges, row heights, column widths and print settings are retained; rules/objects are not translated or recalculated. Unaffected package parts stay byte-for-byte unchanged after decompression.

This tool does not calculate Excel formulas or verify that cached results are current. A formula without a usable saved result blocks review/start and export with worksheet/cell addresses and a request to recalculate/save in Excel and reupload. The check runs before paid requests. It never silently substitutes blank/zero values. Completed legacy downloads are flattened on read without database writes or model calls.

Important restrictions are intentional:

- Numbers, dates, identifiers, English and text already detected in the target language are skipped for translation, but formulas producing those values still become static values in the download.
- Formula-result text, formula-referenced labels and dropdown criteria are eligible in newly confirmed scopes. Dynamic, shared or structured references no longer block translation. Actual Excel table headers remain protected.
- Each new scope stores planVersion 3, including improved local Russian recognition and Unicode-aware Uzbek word boundaries. Existing paid scopes without a marker or with version 2 replay their original language classifier, IDs and batch boundaries; unversioned scopes also retain their original formula exclusions. Upgrading cannot add billable work to an earlier confirmation. Add another worksheet/cell selection to an old job to explicitly include newly eligible text; counters and accepted results remain intact.
- Rich-text cells are protected to avoid losing character-level formatting. Text inside drawings, charts, comments and other non-cell objects is preserved, not translated.
- Suggested table boundaries are heuristic. They are editable and require user review; they are not guaranteed to identify every logical table correctly.
- Language hints/detection are not infallible, especially for short names and mixed-language cells. The model must preserve English spans; validation additionally checks known protected languages and numeric/identifier tokens.
- The browser provides a readable cell-grid preview, not pixel-identical Excel rendering. It displays cached formula values, not a recalculated workbook. Long translations retain original row heights/column widths in the XLSX and may need manual adjustment in Excel.
- There is no automatic retry button that resets spent attempts. Failed jobs retain independently validated cells (including partial batches) but do not offer an incomplete workbook as completed. Reuploading creates a new billable job after confirmation.
- A v1 saved-selection compatibility failure with **zero reserved API requests and no saved translations** can be returned to draft using **Return to review — no API calls**. This retains the upload and selections, and requires review/confirmation before queuing again. Jobs with spent/reserved attempts cannot use this recovery. Selection checksums use deterministic schema-field order, independent of PostgreSQL JSONB key ordering, and remain compatible with the original enqueue hash.
- Translated/Compare views are disabled when no results exist. Active previews keep source text visible with a small queued/translating indicator. Missing accepted results in stopped/completed jobs show **Needs review · original shown**, not an endless pending state or a claimed translation. Completed downloads validate accepted results against the saved plan and are blocked if any required entry is absent.

## Cost and queue controls

- Repeated text is deduplicated within the same sheet/column context and language hint.
- Each batch contains at most 40 unique entries and approximately 8,000 source/context characters. A single eligible cell longer than 8,000 characters is rejected before queuing.
- At most two provider request attempts per batch are reserved durably **before** requests. SDK retries are disabled. Reservations survive worker restarts, timeouts and queue retries; completed batches are reused.
- Responses are validated cell-by-cell. Valid siblings are saved before any corrective call; only unresolved IDs are retried within the same original batch's two-request budget. Specific per-cell validation reasons survive worker restarts and are included in terminal worker errors. They do not contain raw provider responses. Changed-cell counters include partial batches.
- Numeric protection distinguishes explicit Uzbek numbered-prose suffixes (`123-maktab`, `103-sonli`) from immutable serials/codes (`HV23A8284375`, `22-DMTT`). The numeric value and duplicate counts remain protected, with Unicode-aware identifier matching. Requests include the exact protected-token list. This does not loosen checks on arbitrary codes or guarantee semantic translation quality.
- Failed jobs created before per-cell checkpointing cannot recover discarded responses retroactively. The fix does not reset those jobs or their spending counters.
- A validation-exhausted batch is now left pending while later batches proceed within their existing budgets. The job remains incomplete if any required entry fails; no incomplete download is labeled complete. Provider/network failures still follow the bounded queue-retry policy rather than flooding later batches during an outage.
- Rejected, uniquely identified cell candidates are retained separately from accepted translations for diagnosis. They are not returned in usage statistics, previews or completed downloads. Russian-inflected place names with a Latin source-name match may have Uzbek `ҳ` normalized to Russian `х` (e.g. `Yangihayot` / `Янгиҳаётского`). A small verified place-name dictionary also corrects `Чироқчинский район` → `Чиракчинский район`, `город Марғилон` → `город Маргилан`, and `Бўстонлиқский район` → `Бостанлыкский район`, with Russian case endings. Both the corresponding original Latin place name with its Uzbek administrative marker and the Russian administrative context must match. These narrow spelling repairs do not transliterate arbitrary Uzbek prose, change identifiers, or skip language validation. Already accepted results and paid plan IDs/budgets remain unchanged.
- A failed paid job offers **Review resume options — no API calls**. The review shows saved cells, unresolved entries and the maximum additional request count. **Confirm paid recovery** explicitly authorizes one recovery per job: one extra request only for batches already exhausted at confirmation, plus unused original budgets for remaining batches. Previously accepted entries are reused, and all paid request/token counters remain. The server verifies a checkpoint-bound confirmation key, ownership, concurrency and atomic state transition. Repeated confirmations cannot reset budgets or grant further attempts. Existing failed jobs are never resumed automatically.
- Provider timeout is 120 seconds per request, with a 6,000-output-token ceiling. Three worker attempts are available; worker attempts do not reset batch counters.
- Usage returned by invalid responses is counted. Timeouts or a crash before saving provider usage can incur charges without returned token counts. Request reservations are an upper-bound control, not an exact dollar estimate.
- Draft-to-queued transitions use an advisory transaction lock and enforce two active Excel jobs per user. This is a concurrency guard, not a daily quota.
- No additional daily document limit was added.

## No-cost recheck of saved candidates

Stopped jobs with rejected candidates offer **Recheck saved results — no API calls** before paid recovery. The server revalidates those candidates against the original selected-cell plan, retains already accepted text, and reconstructs the XLSX only if every required entry is present and passes. Status and output are committed atomically against the original error-state snapshot with owner checks; active or changed jobs cannot be finalized. No provider calls, queueing, or resets of requests/tokens/attempts occur. If any entry still fails or has no saved candidate, the job remains unchanged and no complete download is offered.

Number protection allows the explicit `maktabi`, `blok`/`блок`, and lowercase Russian ordinal endings such as `2-го` while preserving numbers, their occurrence counts, and arbitrary serial codes. The English-language check allows only `MChJ`/`MCHJ`/`МЧЖ` → `ООО` for Russian when every other character of the cell remains identical. It is not a general exemption for changing English company names. These checks are deterministic safeguards, not a guarantee of semantic translation quality.

Result pages display the saved worksheet/range/column scope. Showing other columns in the grid does not include them in translation or replacement.

## Continue within the same workbook

Completed or stopped Excel jobs with a valid saved selection now support additional translation rounds without reuploading or creating another job:

- **Choose what to translate** stays visible after the first cell is submitted. Its controls are temporarily disabled during processing and unlock when the job can accept more work. On completed/stopped jobs, this panel builds a fresh selection of worksheets, suggested tables, ranges, columns and source-language hints; **Review selection** uses the existing additional-translation confirmation. Historical selections remain in the job summary and are never automatically added to the new scope. The target language remains fixed for that job.
- Open a worksheet tab and choose **Translate this worksheet**, or click a cell to display its contextual **Translate B2** action. There are no per-cell checkboxes. A plain click replaces the selection; Ctrl/Cmd + click adds/removes cells across worksheets. **Select visible text** selects eligible cells in the current grid view (up to 200); the worksheet action covers the full worksheet. Use **Clear cell selection** to discard picks. Merged cells are selected by their anchor. Enter/Space selects focused cells; arrow keys move grid focus. The preview uses the available window width and keeps scrolling inside the grid.
- Protected cells can be clicked for an explanation: already in the selected target language, English preserved, numeric/identifier content, rich text or native table headers. Selecting or inspecting a cell makes no translation request. The new local language detector recognizes Russian phrases such as the reported sports-centre and panel-maintenance cells without sending them for Russian-to-Russian translation; short/ambiguous names can still require model review.
- Initial and additional confirmations clear the previous cell picks. A completed round with an accepted unchanged result and zero changed cells still allows further worksheet/cell rounds; its message distinguishes review from an actual text change. Selecting a cell always uses the original source, even in Translated/Compare mode.
- Review the exact scope, fixed job target language, protected-cell count, previously translated cells selected for replacement, and maximum additional requests. **Confirm additional translation** queues work; reviewing or cancelling does not call the model.
- New work uses the original source workbook, not already translated text. Only the explicitly selected cells are replaced. Identical text outside the selection is unaffected. Previous translations, original input, job ID and all request/token totals are retained. The download is rebuilt from all currently accepted cells when all required work passes.
- Additions are allowed only when no worker is processing that job. English, identifiers, rich text and native table-header protections still apply. Formula-result text and dependent labels are eligible. Up to 200 individual cells/ranges per confirmation and 200 additions per workbook are safety bounds, not daily quotas.
- Each addition has immutable namespaced entry IDs and batch-budget keys. Earlier budgets never reset, and a new scope does not authorize requests on unrelated unresolved batches from earlier rounds. Such older pending cells still prevent a complete download until explicitly recovered or selected for replacement. The existing one-time paid-recovery review can grant recovery for the current snapshot.
- Confirmation is bound to the owner, exact selection and job/checkpoint snapshot. An atomic transition rejects stale or duplicate submissions. The two-active-job concurrency guard also applies.

Browser requests time out after 45 seconds. Preview fetches retry transient connection/server failures up to three times with 1/2/4-second delays. **Retry preview** repeats only the read, not translation. A terminal status cannot leave an animated pending badge indefinitely if the final preview read fails. Successful queue submissions disable repeat confirmation immediately, even if the subsequent status read fails. If the mutation response itself is lost, actions remain disabled while read-only inspection reconciles the saved job; no paid submission is automatically retried. Changing the highlighted cells also invalidates an earlier draft confirmation, requiring review of the new selection.

This change uses existing JSON payload/checkpoint fields; no new migration is required. Restart both the web process and worker together before testing. New version-3 selection scopes require the updated worker; old workers reject this version rather than process it under earlier eligibility rules. No existing job is automatically resumed or changed by installing the code.

## Upload and storage safety

The shared file-upload endpoint retains its 512 MiB file limit and 516 MiB multipart-body limit. XLSX additionally has a 128 MiB total expanded-package limit, a 32 MiB individual expanded-part limit, at most 20,000 ZIP entries, 200 worksheets and one million populated cells. These prevent unsafe ZIP expansion and unbounded memory use. A file below 512 MiB may still exceed these workbook-processing limits.

XLSX ZIP entries are processed in memory, not extracted to the filesystem. XML DTD/entity declarations and unsafe/duplicate archive paths are rejected. APIs enforce ownership and no-store caching; mutation routes reject cross-origin requests when an Origin header is supplied. In production this check uses the public origin configured in NEXTAUTH_URL, not the private Next.js address behind Nginx or untrusted forwarded-host headers. Local development uses the request origin. Download names are sanitized.

Excel records use the existing `background_jobs` table with job type `xlsx_translation_v1` and a `draft` state before queuing. No new Prisma schema or migration is introduced by this feature. The existing queue schema, concurrency trigger and generic worker must already be available. Draft/source/output records currently remain until user deletion or an administrator's established retention policy; this feature does not add automatic record deletion. Deleting a job also removes its usage counters from retained-job analytics.

If a local environment points at production, uploading through that environment writes drafts/jobs to that configured production database and a running worker can process them. The isolated tests below do neither.

## Verification

Unit tests cover workbook detection/structure, selected-cell serialization, shared strings, formula-sensitive text, language/number validation, durable attempt limits, cancellation, ownership and concurrent starts. API tests mock database/provider calls.

```powershell
pnpm -C apps/web test src/lib/xlsx-translator src/components/xlsx-translator src/app/api/xlsx-translator src/app/api/admin/xlsx-translator
pnpm -C apps/web exec tsc --noEmit --incremental false
pnpm -C apps/web exec tsc -p tsconfig.esg-driver-worker.json --noEmit --incremental false
node apps/web/scripts/test-xlsx-translator-ui.mjs
```

The browser smoke test serves an isolated component with mock APIs, verifies selection/review/confirmation/results/mobile overflow, and saves screenshots under `tmp/excel-translator-ui`. It never starts the portal or uses its credentials/database.

The release extends the existing production worker entrypoint with `xlsx_translation_v1`; the PM2 worker command and process name do not change. The local development-only worker refactor and unrelated ESG/Fitch changes are not part of this translator release. Native Excel recalculation and actual paid translation quality require a controlled user test; the isolated suite does not call the model.
