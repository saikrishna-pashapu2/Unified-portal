// Isolated home-page browser regression. All API endpoints below are fixtures:
// no portal server, production database, worker, credentials or paid model calls.
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
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(
  app,
  "src/app/esg/tools/pdf-translator-2/PdfTranslator2Client.tsx",
);
const bundle = await build({
  stdin: {
    contents:
      "import React from 'react';import {createRoot} from 'react-dom/client';import Component from " +
      JSON.stringify(source) +
      ";createRoot(document.getElementById('root')).render(<Component/>);",
    resolveDir: app,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  outdir: path.join(app, ".test-home-bundle"),
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "mock-next",
      setup(b) {
        b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
          path: args.path,
          namespace: "mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
          contents: args.path.endsWith("link")
            ? "import React from 'react';export default function Link(props){return React.createElement('a',props)}"
            : "export function useRouter(){return {push(url){window.__navigation=url}}}",
          resolveDir: app,
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((f) => f.path.endsWith(".css")).text;
const output = path.resolve(app, "../../tmp/translator-home-ui");
await fs.mkdir(output, { recursive: true });
const uuid = (i) =>
  "00000000-0000-4000-8000-" + String(i + 1).padStart(12, "0");
const filenames = [
  "База ФЭС Yashil Energiya.xlsx",
  "Штатка и структура 2024 года.pdf",
  "Реестр сделок магазина.xlsx",
  "Project monitoring workbook.xlsx",
  "Grievance handling policy.pdf",
  "Energy performance report.pdf",
];
const initial = Array.from({ length: 57 }, (_, i) => {
  const kind =
    i === 56 || i === 1 || i === 4 || i === 5 || (i % 3 === 0 && i > 5)
      ? "pdf"
      : "xlsx";
  return {
    id: uuid(i),
    kind,
    filename:
      i === 56
        ? "Legacy contract 2023.pdf"
        : i === 55
          ? "Budget_100%_2024.xlsx"
          : (filenames[i] ??
            "Table export — project " +
              (i + 1) +
              "." +
              (kind === "pdf" ? "pdf" : "xlsx")),
    target_lang: i % 5 === 0 ? "English" : "Russian",
    status:
      {
        1: "processing",
        2: "error",
        3: "draft",
        4: "cancelled",
        5: "queued",
        40: "error",
      }[i] ?? "completed",
    progress: i === 1 ? 62 : i === 5 ? 0 : 100,
    total_pages: kind === "pdf" ? 7 + i : 0,
    created_at:
      i === 56
        ? "2023-11-15T11:34:00Z"
        : new Date(Date.UTC(2026, 8, 9, 10 - i, 34)).toISOString(),
    message:
      i === 2
        ? "Open this job to review saved results and recovery options."
        : null,
  };
});
let records = [...initial],
  historyFailure = false,
  deleteFailure = false;
const historyRequests = [],
  deletions = [],
  uploads = [];
let releaseSlow;
const active = new Set(["processing", "queued", "cancelling"]);
function matchesStatus(item, status) {
  return (
    status === "all" ||
    (status === "active"
      ? active.has(item.status)
      : status === "attention"
        ? ["error", "cancelled"].includes(item.status)
        : item.status === status)
  );
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Cache-Control", "no-store");
  const json = (value, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (url.pathname === "/api/document-translator/history") {
    const q = url.searchParams.get("q") || "",
      kind = url.searchParams.get("kind") || "all",
      status = url.searchParams.get("status") || "all";
    const page = Number(url.searchParams.get("page")),
      size = Number(url.searchParams.get("pageSize"));
    historyRequests.push({ q, kind, status, page, size });
    if (q === "slow")
      await new Promise((resolve) => {
        releaseSlow = resolve;
      });
    if (historyFailure) return json({ error: "History unavailable" }, 503);
    const searched = records.filter(
      (item) =>
        (kind === "all" || item.kind === kind) &&
        item.filename.toLowerCase().includes(q.toLowerCase()),
    );
    const filtered = searched.filter((item) => matchesStatus(item, status));
    const counts = Object.fromEntries(
      ["all", "active", "completed", "attention", "draft"].map((key) => [
        key,
        searched.filter((item) => matchesStatus(item, key)).length,
      ]),
    );
    return json({
      items: filtered.slice((page - 1) * size, page * size),
      total: filtered.length,
      allTotal: records.length,
      counts,
      page,
      size,
    });
  }
  if (req.method === "DELETE") {
    deletions.push(url.pathname);
    if (deleteFailure)
      return json(
        { error: "Delete failed. Your document is still saved." },
        503,
      );
    records = records.filter((item) => !url.pathname.endsWith(item.id));
    return json({ deleted: true });
  }
  if (url.pathname === "/api/pdfx-v2/upload" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    uploads.push(body);
    const kind = body.includes("sample.xlsx") ? "xlsx" : "pdf";
    return json({ kind, jobId: uuid(99) });
  }
  if (url.pathname === "/bundle.js") {
    res.setHeader("Content-Type", "application/javascript");
    return res.end(js);
  }
  if (url.pathname === "/style.css") {
    res.setHeader("Content-Type", "text/css");
    return res.end(css);
  }
  if (url.pathname === "/favicon.ico") {
    res.writeHead(204);
    return res.end();
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Document translator — isolated UI test</title><link rel="stylesheet" href="/style.css"/><style>body{margin:0}button,input,select{font:inherit}button{appearance:none}a{color:inherit}svg{vertical-align:middle}.portal-shell{height:58px;background:#2c9072;color:white;display:flex;align-items:center;justify-content:space-between;padding:0 max(24px,calc((100vw - 1400px)/2));font:12px Aptos,Segoe UI,sans-serif}.portal-shell b{letter-spacing:.08em}.portal-shell span{opacity:.95}@media(max-width:600px){.portal-shell span{display:none}}</style></head><body><header class="portal-shell"><b>ESG</b><span>Home &nbsp;&nbsp;&nbsp; Articles &nbsp;&nbsp;&nbsp; Events &nbsp;&nbsp;&nbsp; Tenders &nbsp;&nbsp;&nbsp; Publications &nbsp;&nbsp;&nbsp; Tools</span><b>S</b></header><div id="root"></div><script src="/bundle.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1150 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(origin + "/")
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin);
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(25);
  await expect(page.locator("footer")).toContainText(
    "Showing 1–25 of 57 documents",
  );
  const seen = new Set();
  for (const count of [25, 25, 7]) {
    await expect(rows).toHaveCount(count);
    for (const href of await rows
      .locator("a[title]")
      .evaluateAll((elements) =>
        elements
          .filter((e) => !e.getAttribute("aria-label"))
          .map((e) => e.getAttribute("href")),
      ))
      seen.add(href);
    if (seen.size < 57)
      await page
        .getByRole("button", { name: "Next page", exact: true })
        .click();
  }
  assert.equal(
    seen.size,
    57,
    "Every saved job must be reachable exactly once across pages",
  );
  await expect(
    page.getByRole("button", { name: "Next page", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("searchbox", { name: "Search all translations" })
    .fill("Legacy");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Legacy contract 2023.pdf");
  await expect(page.locator("footer")).toContainText("Page 1 of 1");
  await page
    .getByRole("combobox", { name: "Document type" })
    .selectOption("xlsx");
  await expect(
    page.getByRole("heading", { name: "No documents match those filters" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .first()
    .click();
  await expect(rows).toHaveCount(25);
  await page.getByRole("button", { name: /^Drafts/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.locator("a[title]").first()).toHaveAttribute(
    "href",
    "/esg/tools/pdf-translator-2/excel/" + uuid(3),
  );
  await page.getByRole("button", { name: /^In progress/ }).click();
  await expect(rows).toHaveCount(2);
  for (const button of await rows
    .getByRole("button", { name: /^Delete translation/ })
    .all())
    await expect(button).toBeDisabled();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .first()
    .click();
  await page.getByRole("searchbox").fill("Budget_100%");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Budget_100%_2024.xlsx");
  await page.getByRole("searchbox").fill("slow");
  await expect
    .poll(() => historyRequests.some((r) => r.q === "slow"))
    .toBe(true);
  await page.getByRole("searchbox").fill("Legacy");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Legacy");
  releaseSlow();
  historyFailure = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "last successfully loaded",
  );
  await expect(rows).toContainText("Legacy");
  historyFailure = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .first()
    .click();
  await page
    .getByRole("combobox", { name: "Documents per page" })
    .selectOption("10");
  await expect(rows).toHaveCount(10);
  await page.screenshot({
    path: path.join(output, "desktop.png"),
    fullPage: true,
  });
  const accessibility = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  console.log(
    "Desktop accessibility",
    JSON.stringify(
      accessibility.violations.map(({ id, nodes }) => ({
        id,
        nodes: nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      })),
    ),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(output, "mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "No horizontal page overflow on mobile",
  );
  const mobileAccessibility = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  console.log(
    "Mobile accessibility",
    JSON.stringify(
      mobileAccessibility.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((node) => node.target),
      })),
    ),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator("main > div")
      .evaluate((element) => getComputedStyle(element).animationName),
    "none",
  );
  records[0] = {
    ...initial[0],
    filename: "Очень-длинное-название-документа-".repeat(7) + ".xlsx",
  };
  await page.reload();
  await expect(rows).toHaveCount(25);
  for (const width of [320, 760, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "No page overflow at " + width + "px, even with long filenames",
    );
  }
  records[0] = initial[0];
  await page.setViewportSize({ width: 1440, height: 1150 });
  await page
    .getByLabel("Upload document", { exact: true })
    .setInputFiles({
      name: "wrong.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("test"),
    });
  await expect(page.getByRole("alert")).toContainText("Choose a PDF or XLSX");
  await page
    .getByLabel("Upload document", { exact: true })
    .setInputFiles({
      name: "sample.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 fixture"),
    });
  await expect(
    page.getByRole("button", { name: "Translate document", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Translate document", exact: true })
    .dblclick();
  await expect.poll(() => uploads.length).toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.__navigation))
    .toBe("/esg/tools/pdf-translator-2/" + uuid(99));
  assert.ok(uploads[0].includes('name="targetLang"\r\n\r\nRussian'));
  await page.reload();
  await page
    .getByLabel("Upload document", { exact: true })
    .setInputFiles({
      name: "sample.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from("fixture"),
    });
  await page
    .getByRole("button", { name: "Choose Excel content", exact: true })
    .click();
  await expect.poll(() => uploads.length).toBe(2);
  await expect
    .poll(() => page.evaluate(() => window.__navigation))
    .toBe("/esg/tools/pdf-translator-2/excel/" + uuid(99));
  records = initial.slice(0, 51);
  await page.reload();
  await expect(rows).toHaveCount(25);
  await page
    .getByRole("combobox", { name: "Documents per page" })
    .selectOption("10");
  await expect(rows).toHaveCount(10);
  await page.getByRole("button", { name: "Last page", exact: true }).click();
  await expect(rows).toHaveCount(1);
  page.once("dialog", (dialog) => dialog.dismiss());
  await rows.getByRole("button", { name: /^Delete translation/ }).click();
  assert.equal(deletions.length, 0);
  page.once("dialog", (dialog) => dialog.accept());
  await rows.getByRole("button", { name: /^Delete translation/ }).click();
  await expect(page.locator("footer")).toContainText(
    "Showing 41–50 of 50 documents",
  );
  await expect(page.locator("footer")).toContainText("Page 5 of 5");
  assert.equal(deletions.length, 1);
  assert.equal(deletions[0], "/api/xlsx-translator/" + uuid(50));
  deleteFailure = true;
  page.once("dialog", (dialog) => dialog.accept());
  await rows
    .getByRole("button", { name: /^Delete translation/ })
    .first()
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Your document is still saved",
  );
  await expect(rows).toHaveCount(10);
  records = initial.slice(0, 17);
  await page.reload();
  await expect(rows).toHaveCount(17);
  await expect(page.locator("footer")).toContainText(
    "Showing 1–17 of 17 documents",
  );
  records = [];
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your document library starts here" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next page", exact: true }),
  ).toBeDisabled();
  assert.deepEqual(pageErrors, []);
  assert.equal(
    accessibility.violations.length,
    0,
    "Desktop accessibility checks",
  );
  assert.equal(
    mobileAccessibility.violations.length,
    0,
    "Mobile accessibility checks",
  );
  console.log(
    JSON.stringify({
      passed: true,
      reachableJobs: seen.size,
      mockedUploads: uploads.length,
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
