// Isolated browser smoke test. No portal server, credentials, database or model.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import http from "node:http";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve("esbuild", { paths: [require.resolve("tsx")] }),
);
const { chromium } = require("@playwright/test");
const postcss = require("postcss"),
  tailwind = require("tailwindcss");
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(
  app,
  "src/components/xlsx-translator/ExcelTranslationClient.tsx",
);
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Component from ${JSON.stringify(source)};createRoot(document.getElementById('root')).render(<Component jobId="11111111-1111-4111-8111-111111111111"/>);`,
    resolveDir: app,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  outdir: path.join(app, ".test-ui-bundle"),
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "mock-next-link",
      setup(b) {
        b.onResolve({ filter: /^next\/link$/ }, () => ({
          path: "link",
          namespace: "mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents: `import React from 'react';export default function Link(props){return React.createElement('a',props)}`,
          resolveDir: app,
        }));
      },
    },
  ],
});
const css = await postcss([
  tailwind({ content: [source], theme: { extend: {} }, plugins: [] }),
]).process("@tailwind base;@tailwind components;@tailwind utilities;", {
  from: undefined,
});
const output = path.resolve(app, "../../tmp/excel-translator-ui");
await fs.mkdir(output, { recursive: true });
let failed = true;
let partial = false;
let paidRecovery = false,
  resumeCalls = 0;
let freeReady = false,
  freeScenario = false,
  recheckCalls = 0;
let started = false,
  startCalls = 0,
  reviewCalls = 0;
let incremental = false,
  additionCalls = 0,
  additionReviews = 0,
  additionScope = [];
let draftCellSelection = false;
let terminalUnavailable = false;
const unavailableWarning =
  "Some selected cells have no saved translation; their original text is preserved. Review cells that still need translation.";
let zeroChanged = false;
let previewFailuresRemaining = 0,
  previewFailureResponses = 0,
  previewRequests = 0;
let loseStartResponse = false,
  loseAdditionResponse = false,
  inspectFailuresRemaining = 0,
  inspectFailureResponses = 0;
let inspectionGate;
let inspectionRequests = 0;
let confirmedScopes = [];
const cleanSelections = (selections) =>
  selections.map(({ columnText, ...selection }) => selection);
const cells = [
  {
    address: "A1",
    row: 1,
    col: 1,
    text: "meterId",
    protection: "English is preserved",
    language: "English",
    style: { bold: true },
  },
  {
    address: "B1",
    row: 1,
    col: 2,
    text: "meterNotes",
    protection: "English is preserved",
    language: "English",
    style: { bold: true },
  },
  {
    address: "A2",
    row: 2,
    col: 1,
    text: "0000123",
    protection: "Identifier / numeric text",
    language: "Unknown",
    style: {},
  },
  {
    address: "B2",
    row: 2,
    col: 2,
    text: "Quyosh panellari",
    language: "Uzbek",
    style: {},
  },
  {
    address: "B3",
    row: 3,
    col: 2,
    text: "English remains unchanged",
    language: "English",
    protection: "English is preserved",
    style: {},
  },
  {
    address: "C2",
    row: 2,
    col: 3,
    text: "Услуга по техническому обслуживанию фотоэлектрических панелей",
    language: "Russian",
    style: {},
  },
  {
    address: "B4",
    row: 4,
    col: 2,
    text: "Quyosh elektr stansiyasi",
    language: "Uzbek",
    style: {},
  },
  {
    address: "C5",
    row: 5,
    col: 3,
    text: "Quyosh quvvati",
    language: "Uzbek",
    style: {},
  },
];
const job = () => ({
  id: "11111111-1111-4111-8111-111111111111",
  filename: "Meter export.xlsx",
  targetLang: "Russian",
  status: paidRecovery
    ? "error"
    : partial
      ? "processing"
      : started
        ? "completed"
        : failed
          ? "error"
          : "draft",
  progress: paidRecovery ? 13 : started ? 100 : 0,
  canDownload: started && !partial && !paidRecovery && !terminalUnavailable,
  canExtend: (started || incremental || paidRecovery) && !partial,
  hasTranslation: started,
  canRestoreDraft: failed,
  canReviewRecovery: paidRecovery,
  canRecheckSaved: freeReady,
  message: paidRecovery
    ? "Translation stopped. Validated cells are retained; the preview is partial and no incomplete download is offered."
    : failed
      ? "Translation did not start because of a saved-selection compatibility error. No translation API requests were made. Return to review to try again."
      : partial
        ? "1 of 2 text batches completed"
        : "Selected cells processed.",
  createdAt: new Date().toISOString(),
  usage: freeScenario
    ? {
        version: 1,
        requests: 103,
        inputTokens: 216519,
        outputTokens: 136287,
        cachedInputTokens: 0,
        translatedCells: freeReady ? 2313 : 2319,
        completedBatches: freeReady ? 54 : 58,
        totalBatches: 58,
      }
    : zeroChanged
      ? {
          version: 1,
          requests: 1,
          inputTokens: 396,
          outputTokens: 70,
          cachedInputTokens: 0,
          translatedCells: 0,
          completedBatches: 1,
          totalBatches: 1,
        }
      : null,
});
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/bundle.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(
      bundle.outputFiles.find((file) => file.path.endsWith(".js")).text,
    );
  }
  if (url.pathname === "/style.css") {
    res.setHeader("Content-Type", "text/css");
    return res.end(
      css.css +
        (bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ||
          ""),
    );
  }
  if (url.pathname.startsWith("/api/xlsx-translator/")) {
    res.setHeader("Content-Type", "application/json");
    let result = job();
    if (req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks));
      if (data.action === "addition-plan") {
        additionReviews++;
        additionScope = cleanSelections(data.selections);
        result = {
          key: "addition-snapshot",
          targetLang: "Russian",
          selections: additionScope,
          selectedCells: 1,
          protectedCells: 0,
          uniqueTexts: 1,
          maxRequests: 2,
          replacingCells: data.selections[0].sheet === "Meters" ? 1 : 0,
        };
      } else if (data.action === "add") {
        assert.equal(data.confirmationKey, "addition-snapshot");
        assert.deepEqual(data.selections, additionScope);
        additionCalls++;
        confirmedScopes.push(...data.selections);
        result = { jobId: job().id };
        if (loseAdditionResponse) {
          loseAdditionResponse = false;
          inspectFailuresRemaining = 1;
          res.statusCode = 503;
          return res.end(
            JSON.stringify({
              error: "Addition committed, but the response was interrupted",
            }),
          );
        }
      } else if (data.action === "plan") {
        reviewCalls++;
        assert.equal(
          data.selections[0].range,
          draftCellSelection ? "B2" : "A1:D3",
        );
        result = {
          selectedCells: 5,
          protectedCells: 4,
          uniqueTexts: 1,
          characters: 16,
          batches: 1,
          maxRequests: 2,
          examples: [
            {
              text: "Quyosh panellari",
              context: "Sheet: Meters; column: meterNotes",
              language: "Uzbek",
            },
          ],
        };
      } else if (data.action === "start") {
        startCalls++;
        confirmedScopes = cleanSelections(data.selections);
        started = true;
        result = { jobId: job().id };
        if (loseStartResponse) {
          loseStartResponse = false;
          inspectFailuresRemaining = 1;
          res.statusCode = 503;
          return res.end(
            JSON.stringify({
              error: "Start committed, but the response was interrupted",
            }),
          );
        }
      } else if (data.action === "restore") {
        assert.equal(startCalls, 0);
        failed = false;
        result = { jobId: job().id };
      } else if (data.action === "recovery-plan") {
        result = {
          key: "reviewed-snapshot",
          maxRequests: 101,
          pendingEntries: 1987,
          savedCells: 328,
          exhaustedBatches: 1,
        };
      } else if (data.action === "resume") {
        assert.equal(data.confirmationKey, "reviewed-snapshot");
        resumeCalls++;
        paidRecovery = false;
        result = { jobId: job().id };
      } else if (data.action === "recheck") {
        recheckCalls++;
        freeReady = false;
        paidRecovery = false;
        result = { jobId: job().id, additionalRequests: 0 };
      }
    } else if (url.searchParams.get("view") === "inspect") {
      inspectionRequests++;
      if (inspectionGate) await inspectionGate;
      if (inspectFailuresRemaining > 0) {
        inspectFailuresRemaining--;
        inspectFailureResponses++;
        res.statusCode = 503;
        return res.end(
          JSON.stringify({
            error:
              "Temporary connection interruption while reconciling saved state",
          }),
        );
      }
      result = {
        job: job(),
        selections:
          failed || freeScenario
            ? [
                {
                  sheet: "Meters",
                  range: "A1:D3",
                  columns: [2],
                  sourceLanguage: "Auto",
                },
              ]
            : confirmedScopes,
        inspection: {
          sheetCount: 2,
          formulaCount: 1,
          mergeCount: 1,
          warnings: ["Formulas and English are protected."],
          sheets: [
            {
              name: "Meters",
              hidden: false,
              range: "A1:D6",
              formulaCount: 0,
              mergeCount: 1,
              protectedCount: 4,
              tables: [
                {
                  id: "one",
                  label: "Meter notes",
                  kind: "detected",
                  range: "A1:D3",
                  rows: 3,
                  columns: 4,
                  languages: { Uzbek: 1, English: 3 },
                },
                {
                  id: "two",
                  label: "Other readings",
                  kind: "detected",
                  range: "A5:D6",
                  rows: 2,
                  columns: 4,
                  languages: { Uzbek: 2 },
                },
              ],
            },
            {
              name: "Internal",
              hidden: !incremental,
              range: "A1:A1",
              formulaCount: 1,
              mergeCount: 0,
              protectedCount: 1,
              tables: [],
            },
          ],
        },
      };
    } else if (url.searchParams.get("view") === "preview") {
      previewRequests++;
      if (previewFailuresRemaining > 0) {
        previewFailuresRemaining--;
        previewFailureResponses++;
        res.statusCode = 503;
        return res.end(
          JSON.stringify({
            error: "Temporary preview connection interruption",
          }),
        );
      }
      result = {
        range: url.searchParams.get("range"),
        merges: ["C5:D5"],
        unavailableCells: terminalUnavailable ? 1 : 0,
        ...(terminalUnavailable
          ? {
              translationWarning: unavailableWarning,
            }
          : {}),
        cells: (incremental && url.searchParams.get("sheet") === "Internal"
          ? [
              {
                address: "A1",
                row: 1,
                col: 1,
                text: "Quyosh stansiyasi",
                language: "Uzbek",
                style: {},
              },
            ]
          : cells
        ).map((c) => ({
          ...c,
          formula: false,
          translated:
            (terminalUnavailable || zeroChanged) && c.address === "B2"
              ? c.text
              : additionScope.some(
                    (selection) =>
                      selection.sheet === "Meters" && selection.range === "B4",
                  ) &&
                  c.address === "B4" &&
                  additionCalls >= 3
                ? "Солнечная электростанция"
                : incremental && additionCalls >= 2 && c.address === "B2"
                  ? "Панели солнечной станции"
                  : incremental &&
                      additionCalls >= 1 &&
                      url.searchParams.get("sheet") === "Internal"
                    ? "Солнечная станция"
                    : started && c.address === "B2"
                      ? "Солнечные панели"
                      : c.text,
          translationPending: partial && c.address === "B2",
          translationUnavailable: terminalUnavailable && c.address === "B2",
        })),
      };
    }
    return res.end(JSON.stringify(result));
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  const cell = (address, sheet = "Meters") =>
    page.getByRole("gridcell", { name: `${sheet}!${address}`, exact: true });
  const actions = page.getByRole("region", {
    name: "Cell actions",
    exact: true,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const inspectionPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  inspectionPage.on("pageerror", (e) => errors.push(e.message));
  let releaseInspection;
  inspectionGate = new Promise((resolve) => {
    releaseInspection = resolve;
  });
  await inspectionPage.clock.install();
  await inspectionPage.goto(`http://127.0.0.1:${server.address().port}`, {
    waitUntil: "domcontentloaded",
  });
  await inspectionPage
    .getByRole("heading", { name: "Inspecting your workbook." })
    .waitFor();
  await inspectionPage
    .getByText("Reading workbook structure", { exact: true })
    .waitFor();
  assert.equal(
    await inspectionPage.getByRole("progressbar").count(),
    0,
    "Inspection must not invent a progress percentage",
  );
  assert.notEqual(
    await inspectionPage
      .getByTestId("workbook-inspection-scan")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
    "The inspection graphic should scan while loading",
  );
  assert.equal(startCalls, 0);
  assert.equal(additionCalls, 0);
  await inspectionPage.screenshot({
    path: path.join(output, "inspection-desktop.png"),
    fullPage: true,
  });
  await inspectionPage.setViewportSize({ width: 390, height: 844 });
  assert(
    await inspectionPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "Inspection page overflows on mobile",
  );
  await inspectionPage.screenshot({
    path: path.join(output, "inspection-mobile.png"),
    fullPage: true,
  });
  await inspectionPage.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await inspectionPage
      .getByTestId("workbook-inspection-scan")
      .evaluate((el) => getComputedStyle(el).display),
    "none",
  );
  assert.equal(
    await inspectionPage
      .locator('[aria-label="Workbook inspection"]')
      .evaluate((el) => el.getAnimations({ subtree: true }).length),
    0,
    "Reduced motion must stop decorative inspection animations",
  );
  await inspectionPage.clock.fastForward(13000);
  await inspectionPage
    .getByText("Still inspecting your workbook", { exact: true })
    .waitFor();
  assert.equal(
    inspectionRequests,
    1,
    "Waiting animation must not start extra inspections",
  );
  inspectionGate = null;
  releaseInspection();
  await inspectionPage
    .getByRole("region", { name: "Workbook preview", exact: true })
    .waitFor();
  assert.equal(
    await inspectionPage
      .getByRole("heading", { name: "Inspecting your workbook." })
      .count(),
    0,
  );
  inspectFailuresRemaining = 1;
  await inspectionPage.reload();
  await inspectionPage
    .getByRole("button", { name: "Retry inspection" })
    .waitFor();
  assert.equal(
    await inspectionPage
      .getByTestId("workbook-inspection-scan")
      .evaluate((el) => getComputedStyle(el).display),
    "none",
    "Error state must not keep scanning",
  );
  await inspectionPage.screenshot({
    path: path.join(output, "inspection-error-mobile.png"),
    fullPage: true,
  });
  const readsBeforeRetry = inspectionRequests;
  await inspectionPage
    .getByRole("button", { name: "Retry inspection" })
    .click();
  await inspectionPage
    .getByRole("region", { name: "Workbook preview", exact: true })
    .waitFor();
  assert.equal(inspectionRequests, readsBeforeRetry + 1);
  assert.equal(startCalls, 0);
  assert.equal(additionCalls, 0);
  await inspectionPage.close();
  inspectFailureResponses = 0;
  console.log(
    "Inspection loading/retry UI passed: desktop, mobile, reduced motion, delayed response, no fake progress or translation requests.",
  );
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page
    .getByText(
      "No translated cells are available yet. Showing original content only.",
    )
    .waitFor();
  assert(
    await page
      .getByRole("button", { name: "translated", exact: true })
      .isDisabled(),
  );
  assert(
    await page
      .getByRole("button", { name: "compare", exact: true })
      .isDisabled(),
  );
  await page.screenshot({
    path: path.join(output, "failed-job.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Return to review — no API calls" })
    .click();
  await page
    .getByRole("heading", { name: "Choose what to translate" })
    .waitFor();
  assert.equal(
    await page.getByLabel("Range for selection 1").inputValue(),
    "A1:D3",
  );
  assert.equal(startCalls, 0);
  assert.equal(
    await page.getByRole("option", { name: "Internal (hidden)" }).count(),
    0,
  );
  await page.getByRole("button", { name: /Meter notes/ }).click();
  await page.getByLabel("Columns for selection 1").fill("B");
  await page.getByRole("button", { name: "Review selection" }).click();
  await page
    .getByRole("heading", { name: "Confirm translation to Russian" })
    .waitFor();
  assert.equal(startCalls, 0);
  assert.equal(reviewCalls, 1);
  await page.screenshot({
    path: path.join(output, "desktop-review.png"),
    fullPage: true,
  });
  await page.getByLabel("Columns for selection 1").fill("B,");
  assert.equal(
    await page
      .getByLabel("Columns for selection 1")
      .getAttribute("aria-invalid"),
    "true",
  );
  await page.getByLabel("Columns for selection 1").fill("B");
  await page.getByRole("button", { name: "Review selection" }).click();
  await page
    .getByRole("button", { name: "Confirm and translate selected cells" })
    .click();
  await page.getByRole("link", { name: "Download translated Excel" }).waitFor();
  await page.getByRole("button", { name: "compare", exact: true }).click();
  await page.getByText("Солнечные панели", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("English remains unchanged", { exact: true }).count(),
    1,
  );
  assert.equal(startCalls, 1);
  await page.screenshot({
    path: path.join(output, "desktop-result.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "Page overflows horizontally on mobile",
  );
  await page.screenshot({
    path: path.join(output, "mobile-result.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  freeReady = true;
  freeScenario = true;
  paidRecovery = true;
  await page.reload();
  await page
    .getByRole("button", { name: "Recheck saved results — no API calls" })
    .waitFor();
  await page.getByText(/Translation scope: Meters · columns B/).waitFor();
  assert.equal(recheckCalls, 0);
  await page.screenshot({
    path: path.join(output, "no-cost-recheck-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Recheck saved results — no API calls" })
    .click();
  await page.getByRole("link", { name: "Download translated Excel" }).waitFor();
  await page.getByText(/103 API requests/).waitFor();
  await page.getByText(/2319 changed cells/).waitFor();
  assert.equal(recheckCalls, 1);
  assert.equal(resumeCalls, 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Recheck saved results — no API calls" })
      .count(),
    0,
  );
  freeScenario = false;
  partial = true;
  await page.reload();
  await page
    .getByText(
      "Partial translation preview. Validated cells are shown; unfinished selected cells are marked as pending.",
    )
    .waitFor();
  await page.getByRole("button", { name: "compare", exact: true }).click();
  await cell("B2").getByText("Translating…", { exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Choose what to translate", exact: true })
    .waitFor();
  assert(
    await page
      .getByRole("button", { name: "Select whole worksheet", exact: true })
      .isDisabled(),
    "The chooser must remain visible but locked during processing",
  );
  assert.equal(
    await page.getByText("Quyosh panellari", { exact: true }).count(),
    1,
  );
  await page.getByRole("button", { name: "translated", exact: true }).click();
  assert.equal(
    await page.getByText("Quyosh panellari", { exact: true }).count(),
    1,
    "An in-flight cell must retain visible source text",
  );
  assert.equal(
    await page.getByText("Translating…", { exact: true }).count(),
    1,
  );
  assert(
    (await cell("B2").locator('[class*="animate-spin"]').count()) > 0,
    "An in-flight cell should show a small translation loader",
  );
  partial = false;
  terminalUnavailable = true;
  await page.reload();
  await page.getByRole("button", { name: "translated", exact: true }).click();
  await cell("B2")
    .getByText("Needs review · original shown", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("Pending translation", { exact: true }).count(),
    0,
    "A terminal job must not leave a cell permanently pending",
  );
  await page.getByText(unavailableWarning, { exact: true }).waitFor();
  await cell("B2").getByText("Quyosh panellari", { exact: true }).waitFor();
  terminalUnavailable = false;
  const callsBeforeRefresh = { startCalls, additionCalls, resumeCalls };
  const requestsBeforeRefresh = previewRequests;
  const failuresBeforeRefresh = previewFailureResponses;
  previewFailuresRemaining = 2;
  await page.reload();
  await cell("B2")
    .getByText("Quyosh panellari", { exact: true })
    .waitFor({ timeout: 15000 });
  assert.equal(previewFailureResponses - failuresBeforeRefresh, 2);
  assert(
    previewRequests - requestsBeforeRefresh >= 3,
    "A failed final preview should retry read-only fetching",
  );
  assert.deepEqual(
    { startCalls, additionCalls, resumeCalls },
    callsBeforeRefresh,
    "Refreshing after a failed GET must not restart paid translation",
  );
  const failuresBeforeExhaustion = previewFailureResponses;
  previewFailuresRemaining = 4;
  await page.reload();
  await page
    .getByText(/Could not refresh the preview\. Saved results are retained/)
    .waitFor({ timeout: 15000 });
  assert.equal(
    previewFailureResponses - failuresBeforeExhaustion,
    4,
    "Preview recovery is bounded to its initial GET and three retries",
  );
  await page
    .getByRole("button", { name: "Retry preview", exact: true })
    .click();
  await cell("B2").getByText("Quyosh panellari", { exact: true }).waitFor();
  assert.deepEqual(
    { startCalls, additionCalls, resumeCalls },
    callsBeforeRefresh,
    "A manual preview retry must only fetch saved results",
  );
  partial = false;
  paidRecovery = true;
  await page.reload();
  await page
    .getByRole("button", { name: "Review resume options — no API calls" })
    .click();
  await page
    .getByRole("heading", { name: "Resume without repeating saved cells" })
    .waitFor();
  assert.equal(resumeCalls, 0);
  assert.equal(
    await page.getByRole("link", { name: "Download translated Excel" }).count(),
    0,
  );
  await page.getByText(/at most 101 additional Luna requests/).waitFor();
  await page.screenshot({
    path: path.join(output, "recovery-mobile.png"),
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  assert.equal(resumeCalls, 0);
  await page
    .getByRole("button", { name: "Review resume options — no API calls" })
    .click();
  await page
    .getByRole("button", { name: "Confirm paid recovery", exact: true })
    .click();
  await page.getByRole("link", { name: "Download translated Excel" }).waitFor();
  assert.equal(resumeCalls, 1);
  assert.equal(
    await page
      .getByRole("button", { name: "Review resume options — no API calls" })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: failed-job views, no-cost recovery with saved selection, review before charge, column edits, result comparison, download and mobile overflow. Mock APIs only.",
  );
  incremental = true;
  await page.setViewportSize({ width: 2400, height: 1200 });
  await page.reload();
  await page
    .getByRole("button", { name: "Translate this worksheet", exact: true })
    .waitFor();
  assert(
    (
      await page
        .getByRole("region", { name: "Workbook preview", exact: true })
        .boundingBox()
    ).width > 2300,
    "Workbook preview remains capped instead of using the window",
  );
  await page.getByRole("button", { name: "Internal", exact: true }).click();
  await cell("A1", "Internal").waitFor();
  await page
    .getByRole("button", { name: "Translate this worksheet", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Additional translation confirmation" })
    .waitFor();
  assert.equal(additionCalls, 0);
  assert.deepEqual(additionScope, [
    { sheet: "Internal", range: "A1:A1", sourceLanguage: "Auto" },
  ]);
  await page
    .getByRole("button", { name: "Cancel addition", exact: true })
    .click();
  assert.equal(additionCalls, 0);
  await page
    .getByRole("button", { name: "Translate this worksheet", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Confirm additional translation",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "compare", exact: true }).click();
  await page.getByText("Солнечная станция", { exact: true }).waitFor();
  assert.equal(additionCalls, 1);
  await page.getByRole("button", { name: "Meters", exact: true }).click();
  await page
    .getByRole("grid", { name: "Workbook cells", exact: true })
    .waitFor();
  await cell("B2").waitFor();
  assert.equal(
    await page.getByRole("checkbox", { name: /Select Meters!/ }).count(),
    0,
    "Cell selection should not require checkboxes",
  );
  for (const [address, reason] of [
    ["A2", /numeric|identifier/i],
    ["B3", /English/],
    ["C2", /Already in Russian/],
  ]) {
    await cell(address).click();
    await actions.getByText(reason).waitFor();
    assert.equal(
      await actions.getByRole("button", { name: /^Translate/ }).count(),
      0,
      `Protected ${address} should explain why without offering a paid translation`,
    );
  }
  await cell("B2").click();
  assert.equal(await cell("B2").getAttribute("aria-selected"), "true");
  await cell("B4").click({ modifiers: ["Control"] });
  assert.equal(await cell("B2").getAttribute("aria-selected"), "true");
  assert.equal(await cell("B4").getAttribute("aria-selected"), "true");
  await cell("B2").click();
  assert.equal(
    await cell("B4").getAttribute("aria-selected"),
    "false",
    "An ordinary cell click replaces the previous selection",
  );
  await page
    .getByRole("button", { name: "Select visible text", exact: true })
    .click();
  for (const address of ["B2", "B4", "C5"])
    assert.equal(await cell(address).getAttribute("aria-selected"), "true");
  for (const address of ["A2", "B3", "C2"])
    assert.equal(await cell(address).getAttribute("aria-selected"), "false");
  assert.equal(
    await cell("D5").count(),
    0,
    "Only the merged-cell anchor should be selectable",
  );
  await cell("B2").click();
  await page.screenshot({
    path: path.join(output, "cell-actions-wide.png"),
    fullPage: true,
  });
  await actions
    .getByRole("button", { name: "Translate B2", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Additional translation confirmation" })
    .waitFor();
  assert.deepEqual(additionScope, [
    { sheet: "Meters", range: "B2", sourceLanguage: "Auto" },
  ]);
  assert.equal(additionCalls, 1);
  await page.getByText(/1 previously translated cells/).waitFor();
  await page
    .getByRole("button", {
      name: "Confirm additional translation",
      exact: true,
    })
    .click();
  await page.getByText("Панели солнечной станции", { exact: true }).waitFor();
  await page.getByText("Quyosh panellari", { exact: true }).waitFor();
  assert.equal(additionCalls, 2);
  assert.equal(additionReviews, 3);
  assert.equal(startCalls, 1, "An addition must not create/start a new job");
  assert.equal(await cell("B2").getAttribute("aria-selected"), "false");
  await page.screenshot({
    path: path.join(output, "incremental-wide.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await cell("B4").click();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(output, "incremental-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: full-window preview, worksheet addition, cell retranslation, protected cells, explicit confirmation/cancel, same-job comparison and mobile. Mock APIs only.",
  );
  incremental = false;
  started = false;
  failed = false;
  draftCellSelection = true;
  zeroChanged = true;
  await page.reload();
  await cell("B2").click();
  await actions
    .getByRole("button", { name: "Translate B2", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Confirm translation to Russian" })
    .waitFor();
  assert.equal(
    await page.getByLabel("Range for selection 1").inputValue(),
    "B2",
  );
  assert.equal(
    startCalls,
    1,
    "Reviewing a draft cell must not start translation",
  );
  const callsBeforeSelectionChange = {
    startCalls,
    additionCalls,
    reviewCalls,
    additionReviews,
  };
  await cell("B4").click();
  assert.equal(
    await page
      .getByRole("button", {
        name: "Confirm and translate selected cells",
        exact: true,
      })
      .count(),
    0,
    "Selecting a different draft cell must invalidate the earlier paid review",
  );
  assert.deepEqual(
    { startCalls, additionCalls, reviewCalls, additionReviews },
    callsBeforeSelectionChange,
    "Changing a reviewed selection must not submit any API action",
  );
  await cell("B2").click();
  await actions
    .getByRole("button", { name: "Translate B2", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Confirm translation to Russian",
      exact: true,
    })
    .waitFor();
  loseStartResponse = true;
  const failedStartInspect = page.waitForResponse(
    (response) =>
      response.url().includes("view=inspect") && response.status() === 503,
  );
  await page
    .getByRole("button", { name: "Confirm and translate selected cells" })
    .click();
  await failedStartInspect;
  await page
    .getByText(
      /Connection interrupted\. Checking job status again automatically/,
    )
    .waitFor();
  assert(
    await page
      .getByRole("button", {
        name: "Confirm and translate selected cells",
        exact: true,
      })
      .isDisabled(),
    "An ambiguous start must lock paid actions until its saved state is known",
  );
  assert(
    await page
      .getByRole("button", { name: "Select visible text", exact: true })
      .isDisabled(),
  );
  await cell("B4").click();
  assert.equal(
    await cell("B4").getAttribute("aria-selected"),
    "false",
    "The selection must remain locked during an uncertain server mutation",
  );
  await page
    .getByRole("link", { name: "Download translated Excel" })
    .waitFor({ timeout: 10000 });
  assert.equal(inspectFailureResponses, 1);
  assert.equal(startCalls, 2);
  await page.getByText(/0 changed cells/).waitFor();
  await page
    .getByRole("heading", { name: "Choose what to translate", exact: true })
    .waitFor();
  assert(
    await page
      .getByRole("button", { name: "Select whole worksheet", exact: true })
      .isEnabled(),
    "Single-cell completion must unlock the full chooser",
  );
  assert(
    await page.getByLabel("Excel target language").isDisabled(),
    "Continuation must preserve the existing job target",
  );
  assert.equal(
    await page.getByLabel("Range for selection 1", { exact: true }).count(),
    0,
    "Previously confirmed cells must not become a new selection",
  );
  assert.equal(
    await cell("B2").getAttribute("aria-selected"),
    "false",
    "The first paid confirmation must clear its cell selection",
  );
  await cell("B4").click();
  await actions
    .getByRole("button", { name: "Translate B4", exact: true })
    .click();
  await page
    .getByRole("region", {
      name: "Additional translation confirmation",
      exact: true,
    })
    .waitFor();
  assert.deepEqual(
    additionScope,
    [{ sheet: "Meters", range: "B4", sourceLanguage: "Auto" }],
    "A next-cell translation must not reuse the first completed cell",
  );
  assert.equal(additionCalls, 2);
  loseAdditionResponse = true;
  const failedAdditionInspect = page.waitForResponse(
    (response) =>
      response.url().includes("view=inspect") && response.status() === 503,
  );
  await page
    .getByRole("button", {
      name: "Confirm additional translation",
      exact: true,
    })
    .click();
  await failedAdditionInspect;
  await page
    .getByText(
      /Connection interrupted\. Checking job status again automatically/,
    )
    .waitFor();
  assert(
    await page
      .getByRole("button", {
        name: "Confirm additional translation",
        exact: true,
      })
      .isDisabled(),
    "An ambiguous addition must not be eligible for duplicate submission",
  );
  assert.equal(
    additionCalls,
    3,
    "A lost addition response must not replay its paid POST",
  );
  await page
    .getByRole("button", {
      name: "Confirm additional translation",
      exact: true,
    })
    .waitFor({ state: "hidden", timeout: 10000 });
  assert.equal(inspectFailureResponses, 2);
  await page.getByRole("button", { name: "compare", exact: true }).click();
  await cell("B4")
    .getByText("Солнечная электростанция", { exact: true })
    .waitFor();
  assert.equal(
    startCalls,
    2,
    "Continuing after a preserved cell must keep the same job",
  );
  assert.equal(additionCalls, 3);
  assert.equal(await cell("B4").getAttribute("aria-selected"), "false");
  await cell("C5").click();
  assert(
    await actions
      .getByRole("button", { name: "Translate C5", exact: true })
      .isEnabled(),
    "Read-only reconciliation must unlock continued cell translation after the committed result is found",
  );
  assert.equal(additionCalls, 3);
  assert.equal(startCalls, 2);
  const chooser = page.getByRole("region", {
    name: "Translation selection",
    exact: true,
  });
  const paidBeforeChooser = { startCalls, additionCalls, resumeCalls };
  await chooser.getByRole("button", { name: /Other readings/ }).click();
  assert.equal(
    await chooser
      .getByLabel("Range for selection 1", { exact: true })
      .inputValue(),
    "A5:D6",
  );
  await chooser
    .getByLabel("Range for selection 1", { exact: true })
    .fill("B4:B6");
  await chooser
    .getByLabel("Columns for selection 1", { exact: true })
    .fill("B");
  await chooser
    .getByLabel("Source language for selection 1", { exact: true })
    .selectOption("Uzbek");
  await chooser
    .getByRole("button", { name: "Review selection", exact: true })
    .click();
  await page
    .getByRole("region", {
      name: "Additional translation confirmation",
      exact: true,
    })
    .waitFor();
  assert.deepEqual(
    additionScope,
    [
      {
        sheet: "Meters",
        range: "B4:B6",
        columns: [2],
        sourceLanguage: "Uzbek",
      },
    ],
    "Continuing through the chooser must send only the new selected range and columns",
  );
  assert.deepEqual(
    { startCalls, additionCalls, resumeCalls },
    paidBeforeChooser,
    "Review must remain free",
  );
  await chooser
    .getByLabel("Columns for selection 1", { exact: true })
    .fill("B,D");
  assert.equal(
    await page
      .getByRole("button", {
        name: "Confirm additional translation",
        exact: true,
      })
      .count(),
    0,
    "Editing a new range must invalidate the previous confirmation",
  );
  await chooser
    .getByLabel("Columns for selection 1", { exact: true })
    .fill("B");
  await chooser
    .getByRole("button", { name: "Review selection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel addition", exact: true })
    .click();
  assert.equal(
    await chooser
      .getByLabel("Range for selection 1", { exact: true })
      .inputValue(),
    "B4:B6",
    "Cancelling review should keep the editable new range",
  );
  assert.deepEqual(
    { startCalls, additionCalls, resumeCalls },
    paidBeforeChooser,
  );
  await chooser
    .getByRole("button", { name: "Review selection", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Confirm additional translation",
      exact: true,
    })
    .click();
  await chooser.getByText(/No new ranges selected/).waitFor();
  assert.equal(additionCalls, paidBeforeChooser.additionCalls + 1);
  assert.equal(startCalls, paidBeforeChooser.startCalls);
  assert(
    confirmedScopes.some((s) => s.range === "B2"),
    "The saved initial cell scope must remain intact",
  );
  assert(
    confirmedScopes.some((s) => s.range === "B4:B6"),
    "The new scope must be added to the same job",
  );
  await page.reload();
  await page
    .getByRole("heading", { name: "Choose what to translate", exact: true })
    .waitFor();
  assert.equal(
    await chooser.getByLabel("Range for selection 1", { exact: true }).count(),
    0,
    "Reloading a completed workbook must keep historical ranges out of the new chooser",
  );
  await chooser.getByLabel("Show hidden worksheets", { exact: true }).check();
  await chooser
    .getByLabel("Worksheet to select tables", { exact: true })
    .selectOption("Internal");
  await chooser
    .getByRole("button", { name: "Select whole worksheet", exact: true })
    .click();
  assert.equal(
    await chooser
      .getByLabel("Range for selection 1", { exact: true })
      .inputValue(),
    "A1:A1",
  );
  assert.equal(
    await chooser.getByRole("heading", { name: /New selected ranges/ }).count(),
    1,
  );
  await chooser.getByRole("button", { name: "Remove", exact: true }).click();
  await chooser
    .getByLabel("Worksheet to select tables", { exact: true })
    .selectOption("Meters");
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "The persistent chooser must not overflow on mobile",
  );
  await page.screenshot({
    path: path.join(output, "persistent-chooser-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({
    path: path.join(output, "persistent-chooser-desktop.png"),
    fullPage: true,
  });
  console.log(
    "PASS: persistent chooser during processing and after single-cell completion; new table/range/column scopes, fixed target, stale review invalidation, same-job additions, worksheet selection, reload and no historical resubmission.",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: cell-click actions, protected-cell reasons, visible/additive selection, live loader, terminal review flags, read-only preview retry, stale review invalidation, lost mutation-response reconciliation without duplicate POST, and continuous same-job translation after an unchanged accepted cell. Mock APIs only.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
