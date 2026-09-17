// Isolated admin translator ledger browser regression. Every API response is
// served by this local fixture; it never calls the portal, databases, workers,
// credentials, or translation providers.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import http from "node:http";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve("esbuild", { paths: [require.resolve("tsx")] }),
);
const postcss = require("postcss");
const tailwindcss = require("tailwindcss");
const autoprefixer = require("autoprefixer");
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(
  app,
  "src/components/document-translator/AdminTranslatorJobs.tsx",
);
const bundle = await build({
  stdin: {
    contents: [
      "import React from 'react';",
      "import {createRoot} from 'react-dom/client';",
      `import AdminTranslatorJobs from ${JSON.stringify(source)};`,
      "const root=createRoot(document.getElementById('root'));",
      "window.renderAdminJobs=(props)=>root.render(React.createElement(AdminTranslatorJobs,props));",
      "window.renderAdminJobs({period:'30',refreshKey:0});",
    ].join(""),
    resolveDir: app,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  outdir: path.join(app, ".test-admin-translator-jobs"),
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const tailwindConfig = require(path.join(app, "tailwind.config.js"));
const globalCssPath = path.join(app, "src/app/globals.css");
const globalCss = await fs.readFile(globalCssPath, "utf8");
const css = (
  await postcss([
    tailwindcss({ ...tailwindConfig, content: [source] }),
    autoprefixer(),
  ]).process(globalCss, { from: globalCssPath })
).css;
const output = await fs.mkdtemp(path.join(os.tmpdir(), "translator-admin-ui-"));

const records = Array.from({ length: 56 }, (_, index) => {
  const kind = index % 2 === 0 ? "pdf" : "xlsx";
  const status =
    {
      0: "error",
      1: "draft",
      2: "queued",
      3: "processing",
      5: "cancelled",
      6: "error",
    }[index] ?? "completed";
  return {
    kind,
    id: `fixture-${index + 1}`,
    filename:
      index === 0
        ? "Failed report.pdf"
        : index === 1
          ? "Draft workbook.xlsx"
          : index === 6
            ? "Broken input.pdf"
            : index === 53
              ? "Budget_100%_FY2026.xlsx"
              : index === 54
                ? "Legacy contract.pdf"
                : `${kind === "pdf" ? "Report" : "Workbook"} project ${index + 1}.${kind === "pdf" ? "pdf" : "xlsx"}`,
    targetLanguage: index % 2 ? "Russian" : "English",
    status,
    stage: status === "error" ? "translation_error" : status,
    progress:
      status === "completed" ? 100 : status === "processing" ? 62 : 0,
    totalPages: kind === "pdf" ? 7 + index : null,
    changedCells: kind === "xlsx" ? 18 + index : null,
    createdAt: new Date(Date.UTC(2026, 8, 9, 10, 34 - index)).toISOString(),
    completedAt:
      status === "completed"
        ? new Date(Date.UTC(2026, 8, 9, 11, 34 - index)).toISOString()
        : null,
    userName: `Translator ${index + 1}`,
    userEmail: index === 5 ? null : `translator${index + 1}@example.test`,
    inputTokens: 100 + index,
    outputTokens: 200 + index,
    requests: kind === "xlsx" ? 1 + (index % 4) : null,
    message:
      index === 0
        ? "The provider call failed after retries."
        : index === 6
          ? "The source could not be read during import."
          : null,
    error:
      index === 0
        ? "Provider returned HTTP 429 while translating this document."
        : null,
    errorTruncated: index === 0,
  };
});

const historyRequests = [];
let historyFailure = false;
let releaseSlow;
const activeStatuses = new Set(["queued", "processing", "cancelling"]);
const matchesStatus = (item, status) =>
  status === "all" ||
  (status === "active"
    ? activeStatuses.has(item.status)
    : status === "attention"
      ? ["error", "cancelled"].includes(item.status)
      : item.status === status);

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  response.setHeader("Cache-Control", "no-store");
  const json = (value, status = 200) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  };

  if (url.pathname === "/api/admin/document-translator/jobs") {
    const q = url.searchParams.get("q") || "";
    const kind = url.searchParams.get("kind") || "all";
    const status = url.searchParams.get("status") || "all";
    const page = Number(url.searchParams.get("page"));
    const size = Number(url.searchParams.get("pageSize"));
    const period = url.searchParams.get("period");
    historyRequests.push({ q, kind, status, page, size, period });

    if (q === "slow") {
      await new Promise((resolve) => {
        releaseSlow = resolve;
      });
    }
    if (historyFailure)
      return json({ error: "The retained job service is unavailable." }, 503);

    const searched = records.filter(
      (item) =>
        (kind === "all" || item.kind === kind) &&
        item.filename.toLocaleLowerCase().includes(q.toLocaleLowerCase()),
    );
    const filtered = searched.filter((item) => matchesStatus(item, status));
    const total = filtered.length;
    return json({
      success: true,
      items: filtered.slice((page - 1) * size, page * size),
      total,
      page,
      size,
    });
  }

  if (url.pathname === "/bundle.js") {
    response.setHeader("Content-Type", "application/javascript");
    return response.end(js);
  }
  if (url.pathname === "/style.css") {
    response.setHeader("Content-Type", "text/css");
    return response.end(css);
  }
  if (url.pathname === "/favicon.ico") {
    response.writeHead(204);
    return response.end();
  }
  response.setHeader("Content-Type", "text/html");
  return response.end(`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Admin translator jobs — isolated UI test</title><link rel="stylesheet" href="/style.css"/>
    </head><body><main id="root"></main><script src="/bundle.js"></script></body></html>`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const pageErrors = [];

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 980 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(`${origin}/`)
      ? route.continue()
      : route.abort(),
  );

  await page.goto(origin);
  const rows = page.locator("tbody tr");
  const footer = page.getByRole("status").filter({ hasText: "Showing" });
  await expect(rows).toHaveCount(25);
  await expect(footer).toContainText("Showing 1–25 of 56 jobs");
  assert.ok(
    historyRequests.some(
      (request) =>
        request.period === "30" &&
        request.kind === "all" &&
        request.status === "all" &&
        request.page === 1 &&
        request.size === 25,
    ),
    "Initial request carries period, file type, status, and pagination filters",
  );

  const nextPage = page.getByRole("button", { name: "Next jobs page" });
  await nextPage.focus();
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(25);
  await expect(page.getByText("Page 2 of 3")).toBeVisible();
  await nextPage.click();
  await expect(rows).toHaveCount(6);
  await expect(page.getByText("Page 3 of 3")).toBeVisible();
  await page.getByRole("button", { name: "Previous jobs page" }).click();
  await page.getByRole("button", { name: "Previous jobs page" }).click();
  await expect(page.getByText("Page 1 of 3")).toBeVisible();

  await page.getByRole("combobox", { name: "Job status" }).selectOption("attention");
  await expect(rows).toHaveCount(3);
  const failedRow = rows.filter({ hasText: "Failed report.pdf" });
  await failedRow.locator("summary").click();
  await expect(failedRow).toContainText(
    "Provider returned HTTP 429 while translating this document.",
  );
  await expect(failedRow).toContainText("The stored error was truncated.");
  const noStoredErrorRow = rows.filter({ hasText: "Broken input.pdf" });
  await noStoredErrorRow.locator("summary").click();
  await expect(noStoredErrorRow).toContainText(
    "Latest status message (not the stored error):",
  );
  await expect(noStoredErrorRow).toContainText(
    "The source could not be read during import.",
  );

  await page.getByRole("combobox", { name: "Job status" }).selectOption("all");
  await page.getByRole("combobox", { name: "Document type" }).selectOption("xlsx");
  await expect(rows).toHaveCount(25);
  await expect(rows.first()).toContainText("Excel");
  await nextPage.click();
  await expect(rows).toHaveCount(3);
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Previous jobs page" }).click();
  await expect(rows).toHaveCount(25);

  const search = page.getByRole("searchbox", { name: "Search filenames" });
  await search.fill("Budget_100%");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Budget_100%_FY2026.xlsx");
  await expect(page.getByText("Page 1 of 1")).toBeVisible();
  assert.ok(
    historyRequests.some((request) => request.q === "Budget_100%"),
    "Percent is passed as a literal filename character after URL decoding",
  );

  let refreshCount = historyRequests.length;
  historyFailure = true;
  await page.getByRole("button", { name: "Refresh jobs" }).click();
  await expect(page.getByRole("alert")).toContainText("Job list refresh failed");
  await expect(rows).toContainText("Budget_100%_FY2026.xlsx");
  historyFailure = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(() => historyRequests.length > refreshCount)
    .toBe(true);
  refreshCount = historyRequests.length;

  await page.getByRole("combobox", { name: "Document type" }).selectOption("all");
  await search.fill("slow");
  await expect.poll(() => historyRequests.some((request) => request.q === "slow")).toBe(true);
  await search.fill("Legacy");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Legacy contract.pdf");
  releaseSlow?.();
  await expect(rows).toContainText("Legacy contract.pdf");

  await search.fill("filename-with-no-match");
  await expect(
    page.getByText("No translator jobs match these filters", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(rows).toHaveCount(25);

  await nextPage.click();
  await expect(page.getByText("Page 2 of 3")).toBeVisible();
  await page.evaluate(() => window.renderAdminJobs({ period: "7", refreshKey: 0 }));
  await expect
    .poll(() =>
      historyRequests.some(
        (request) => request.period === "7" && request.page === 1,
      ),
    )
    .toBe(true);
  await expect(page.getByText("Page 1 of 3")).toBeVisible();

  refreshCount = historyRequests.length;
  await page.evaluate(() => window.renderAdminJobs({ period: "7", refreshKey: 1 }));
  await expect.poll(() => historyRequests.length > refreshCount).toBe(true);
  await expect(rows).toHaveCount(25);

  const accessibility = await new AxeBuilder({ page })
    .include("#root")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.equal(
    accessibility.violations.length,
    0,
    `Desktop accessibility violations: ${JSON.stringify(
      accessibility.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
      })),
    )}`,
  );

  await page.screenshot({ path: path.join(output, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "The page should not overflow horizontally on mobile",
  );
  const ledgerWrap = page.locator('table[aria-label="PDF and Excel translation jobs"]').locator("xpath=..");
  const scrollSizes = await ledgerWrap.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  assert.ok(
    scrollSizes.scrollWidth > scrollSizes.clientWidth,
    "The wide ledger scrolls inside its own wrapper on mobile",
  );
  await page.screenshot({ path: path.join(output, "mobile.png"), fullPage: true });
  const mobileAccessibility = await new AxeBuilder({ page })
    .include("#root")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.equal(
    mobileAccessibility.violations.length,
    0,
    `Mobile accessibility violations: ${mobileAccessibility.violations.map((item) => item.id).join(", ")}`,
  );
  assert.deepEqual(pageErrors, [], "The ledger should not throw browser errors");

  console.log(
    JSON.stringify({
      passed: true,
      exercised: [
        "pagination",
        "PDF/Excel filter",
        "status filter",
        "literal percent search",
        "stored and fallback errors",
        "refresh failure and retry",
        "stale-response protection",
        "period page reset",
        "refreshKey reload",
        "mobile internal scrolling",
        "desktop and mobile accessibility",
      ],
      apiCalls: historyRequests.length,
      realApiCalls: 0,
      screenshots: [
        path.join(output, "desktop.png"),
        path.join(output, "mobile.png"),
      ],
    }),
  );
} finally {
  releaseSlow?.();
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
