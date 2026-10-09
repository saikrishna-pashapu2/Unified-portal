import { expect, test, type Page } from "@playwright/test";
import { authenticateE2eUser } from "./auth";
import workbook from "../src/lib/esg-drivers/workbook.generated.json";

const NOW = "2026-09-09T10:00:00.000Z";
const SOURCE_URL = "https://www.unep.org/resources/report/example-esg-guidance";

function makeDrivers(count: number) {
  const rows = workbook.sheets.find((sheet) => sheet.name === 'Banking')!.drivers.filter((d) => d.section === 'Global Drivers' || d.section === 'UAE');
  return rows.slice(0, count).map((row, index) => ({
    id: row.id, driverSection: row.section, driverType: row.type,
    driverTitle: row.name, workbookRow: row.row, workbookSheet: row.sheet,
    generationStatus: 'verified', statusReason: '',
    evidenceStatus: index === 0 ? 'historical' : 'dated-update', evidenceDate: index === 0 ? '2016' : '2026',
    evidenceLimitation: index === 0 ? 'Historical study; current banking outcomes are not established.' : '',
    driverText: "Current official guidance creates a decision-relevant ESG signal.",
    countrySectorRelevance: "Relevant to UAE banking strategy and risk governance.",
    evidenceKpi: "Official 2030 policy milestone confirmed by the cited source.",
    keySources: ["UN Environment Programme"],
    sourceLinks: [SOURCE_URL],
    confidence: 90,
    lastChecked: "2026-07-14",
    sourceRefs: ["S1"],
    driverLogicId: `catalog-driver-${index + 1}`,
    driverLogic: "Track the latest approved-source ESG signal.",
  }));
}

function makeResult(completion: "complete" | "partial") {
  const driverCount = 52;
  return {
    country: "UAE",
    sector: "Banking",
    language: "English",
    catalogVersion: workbook.version, workflow: "excel-sources", workbook: workbook.workbook,
    verifiedDriverCount: completion === "complete" ? 52 : 50,
    generatedAt: NOW,
    drivers: makeDrivers(driverCount).map((driver, i) => completion === "partial" && i >= 50 ? { ...driver, generationStatus: "unavailable", statusReason: "No supporting evidence at the Excel URLs.", sourceLinks: [], sourceRefs: [], keySources: [], confidence: 0 } : driver),
    evidence: [
      {
        id: "S1",
        title: "Official ESG guidance",
        url: SOURCE_URL,
        domain: "unep.org",
        snippet: "Official policy guidance with a 2030 milestone.",
        contentSnippet: "Official policy guidance with a 2030 milestone.",
        retrievalStatus: "retrieved",
        evidenceProvenance: "retrieved-page",
        isContextualFallback: false,
        finalUrl: SOURCE_URL,
        retrievalError: null,
        publishedDate: "2026-06-01",
        updatedDate: "2026-06-01",
        lastModified: "2026-06-01",
        retrievedAt: NOW,
        authorityScore: 95,
        freshnessScore: 95,
        relevanceScore: 95,
        sourceScore: 95,
      },
    ],
    warnings: completion === "partial" ? ["Two driver updates are unavailable."] : [],
    completion,
    expectedDriverCount: 52,
    slotFailures:
      completion === "partial"
        ? [51, 52].map((driverNumber) => ({
            driverId: `D${driverNumber}`,
            driverNumber,
            originalDriverLogicId: `catalog-driver-${driverNumber}`,
            attemptedDriverLogicIds: [`catalog-driver-${driverNumber}`],
            reasons: ["No approved direct-page evidence was available."],
            createdAt: NOW,
          }))
        : [],
  };
}

function makeRelevance(index: number) {
  const score = Math.max(51, 96 - index * 2);
  return {
    assessmentVersion: 'driver-specific-v2' as const,
    review: { reviewer: { model: 'gpt-5.6-luna', responseId: `review-${index + 1}` }, checks: { exactDriverSupport: true, noBorrowedObligations: true, urgencySupported: true, ratingsProportionate: true } },
    policyVersion: "relevance-top15-v1" as const,
    score,
    band: score >= 75 ? ("high" as const) : ("medium" as const),
    dimensions: {
      country: {
        rating: 5 - (index % 3),
        reason: "Direct UAE evidence describes the country context.",
        passageIds: ["P1"],
      },
      sector: {
        rating: 4 - (index % 2),
        reason: "The source addresses banking risk and governance.",
        passageIds: ["P1"],
      },
      businessImpact: {
        rating: 4,
        reason: "The driver can affect financing, controls, or portfolio decisions.",
        passageIds: ["P1"],
      },
      urgency: {
        rating: 3 + (index % 3 === 0 ? 2 : 0),
        reason: "The dated requirement gives the decision a clear planning horizon.",
        passageIds: ["P1"],
      },
    },
    rationale: "Selected for strong country and banking relevance with a clear decision horizon.",
    assessedAt: NOW,
    evidenceFingerprint: `fingerprint-${index + 1}`,
    assessor: { model: "gpt-5.6-luna", responseId: `response-${index + 1}` },
  };
}

function makeRankedResult(
  publishedCount: number,
  unavailableCount: number,
  withOwnSourceDate = false,
) {
  const allCandidates = makeDrivers(52).map((driver, index) => {
    const unavailable =
      index >= publishedCount && index < publishedCount + unavailableCount;
    return {
      ...driver,
      generationStatus: unavailable ? ("unavailable" as const) : ("verified" as const),
      relevance: unavailable ? undefined : makeRelevance(index),
      statusReason: unavailable ? "No direct source-supported update was available." : "",
      sourceLinks: unavailable ? [] : [SOURCE_URL],
      sourceRefs: unavailable ? [] : ["S1", "S2"],
      keySources: unavailable ? [] : ["UN Environment Programme", "Official banking guidance"],
    };
  });
  const excluded = allCandidates.slice(publishedCount).map((candidate, index) => {
    const unavailable = index < unavailableCount;
    return {
      driverId: candidate.id,
      reason: unavailable ? ("unavailable" as const) : ("below-cutoff" as const),
    };
  });

  const sourceDate = withOwnSourceDate
    ? {
        value: "June 2026",
        kind: "published" as const,
        evidence: "Published June 2026",
        location: "cover page",
      }
    : null;
  const evidence = [
    {
      id: "S1",
      title: "Official ESG guidance",
      url: SOURCE_URL,
      domain: "unep.org",
      snippet: "Official policy guidance with a 2030 milestone.",
      contentSnippet: "Official policy guidance with a 2030 milestone.",
      retrievalStatus: "retrieved",
      evidenceProvenance: "retrieved-page",
      isContextualFallback: false,
      finalUrl: SOURCE_URL,
      retrievalError: null,
      publishedDate: withOwnSourceDate ? "1999-01-01" : null,
      updatedDate: withOwnSourceDate ? "2000-01-01" : null,
      lastModified: "2026-09-14",
      sourceDate,
      retrievedAt: NOW,
      authorityScore: 95,
      freshnessScore: 95,
      relevanceScore: 95,
      sourceScore: 95,
      passages: [{ id: "P1", text: "Official guidance for banking decisions.", location: "p. 1" }],
    },
    {
      id: "S2",
      title: "Banking context page",
      url: "https://www.unep.org/resources/report/example-banking-context",
      domain: "unep.org",
      snippet: "Banking context without a stated publication date.",
      contentSnippet: "Banking context without a stated publication date.",
      retrievalStatus: "retrieved",
      evidenceProvenance: "retrieved-page",
      isContextualFallback: false,
      finalUrl: "https://www.unep.org/resources/report/example-banking-context",
      retrievalError: null,
      publishedDate: null,
      updatedDate: null,
      lastModified: "2026-09-14",
      sourceDate: null,
      retrievedAt: NOW,
      authorityScore: 90,
      freshnessScore: 90,
      relevanceScore: 90,
      sourceScore: 90,
      passages: [{ id: "P2", text: "Banking context.", location: "p. 2" }],
    },
  ];

  return {
    country: "UAE",
    sector: "Banking",
    language: "English",
    catalogVersion: workbook.version,
    workflow: "excel-sources",
    workbook: workbook.workbook,
    verifiedDriverCount: publishedCount,
    generatedAt: NOW,
    drivers: allCandidates.slice(0, publishedCount),
    candidatePool: allCandidates,
    selection: {
      policyVersion: "relevance-top15-v1" as const,
      requestedCount: 15,
      minimumScore: 50,
      candidateCount: allCandidates.length,
      supportedCandidateCount: allCandidates.length - unavailableCount,
      eligibleCandidateCount: allCandidates.length - unavailableCount,
      publishedDriverIds: allCandidates.slice(0, publishedCount).map((driver) => driver.id),
      excluded,
      assessedAt: NOW,
    },
    evidence,
    warnings: unavailableCount > 0 ? ["Some workbook candidates were unavailable."] : [],
    completion: publishedCount === 15 ? "complete" : "partial",
    expectedDriverCount: 15,
    slotFailures: [],
  };
}

async function mockDriverApis(
  page: Page,
  options: { delayedCatalogPagination?: boolean; delayedHistoryPreview?: boolean } = {},
) {
  const parentResult = makeResult("partial");
  const childResult = makeResult("complete");
  const rankedCompleteResult = makeRankedResult(15, 0);
  const rankedGapResult = makeRankedResult(15, 2, true);
  const rankedPartialResult = makeRankedResult(12, 2);
  const rejectedReason = 'The proposed score borrowed a deadline from another regulation.';
  const rankedUnscoredResult = {
    ...rankedCompleteResult,
    candidatePool: rankedCompleteResult.candidatePool.map((driver, index) => index === 15 ? {
      ...driver, relevance: undefined, statusReason: rejectedReason,
      relevanceFailure: { assessment: { ...driver.relevance!, review: { ...driver.relevance!.review, checks: { ...driver.relevance!.review.checks, noBorrowedObligations: false } } }, reasons: [rejectedReason] },
    } : driver),
    selection: { ...rankedCompleteResult.selection, excluded: rankedCompleteResult.selection.excluded.map((item, index) => index === 0 ? { ...item, reason: 'unscored' } : item) },
    warnings: ['One supported candidate has no approved relevance score.'],
  };
  const resultByJob: Record<string, unknown> = {
    "ranked-job": rankedCompleteResult,
    "ranked-gap-job": rankedGapResult,
    "ranked-partial-job": rankedPartialResult,
    "ranked-date-job": rankedGapResult,
    "ranked-child-job": rankedCompleteResult,
    "ranked-unscored-job": rankedUnscoredResult,
  };

  const activeWorkbook = {
    id: "catalog-active-v3",
    version: "2026-09-09-v3",
    workbook: "ESG_Drivers_September.xlsx",
    sha256: "active-sha256",
    uploadedAt: NOW,
    uploadedBy: { id: 1, name: "Catalog owner" },
    driverCount: 92,
    sheetCount: 5,
    sourceCount: 17,
    isActive: true,
    isBundled: true,
  };
  const previousWorkbook = {
    ...activeWorkbook,
    id: "catalog-previous-v2",
    version: "2026-08-20-v2",
    workbook: "ESG_Drivers_August.xlsx",
    sha256: "previous-sha256",
    uploadedAt: "2026-08-20T09:00:00.000Z",
    uploadedBy: { id: 2, name: "Previous uploader" },
    driverCount: 91,
    sourceCount: 16,
    isActive: false,
    isBundled: false,
  };
  const uploadedWorkbook = {
    ...activeWorkbook,
    id: "catalog-upload-v4",
    version: "2026-09-09-v4",
    workbook: "ESG_Drivers_September_new.xlsx",
    uploadedBy: { id: 9, name: "Test uploader" },
    isActive: false,
    isBundled: false,
    uploadedAt: NOW,
  };
  const catalogOptions: {
    workbook: string;
    version: string;
    countries: string[];
    sectors: string[];
    counts: Record<string, Record<string, number>>;
  } = {
    workbook: activeWorkbook.workbook,
    version: activeWorkbook.version,
    countries: ["Kazakhstan", "Uzbekistan", "UAE", "Saudi Arabia"],
    sectors: ["Banking", "Energy", "Oil & Gas", "Mining & Metals", "Real Estate"],
    counts: {
      Banking: { UAE: 52, Kazakhstan: 52, Uzbekistan: 52, "Saudi Arabia": 52 },
      Energy: { UAE: 45, Kazakhstan: 45, Uzbekistan: 40, "Saudi Arabia": 45 },
      "Oil & Gas": { UAE: 36, Kazakhstan: 36, Uzbekistan: 36, "Saudi Arabia": 36 },
      "Mining & Metals": { UAE: 28, Kazakhstan: 28, Uzbekistan: 28, "Saudi Arabia": 28 },
      "Real Estate": { UAE: 40, Kazakhstan: 40, Uzbekistan: 40, "Saudi Arabia": 40 },
    },
  };
  let catalogRevision = 7;
  let currentActive = activeWorkbook;
  let currentOptions = catalogOptions;
  let currentVersions = [activeWorkbook, previousWorkbook];
  const catalogActivations = [{
    id: "activation-v3",
    versionId: activeWorkbook.id,
    workbook: activeWorkbook.workbook,
    activatedAt: NOW,
    activatedBy: { id: 1, name: "Catalog owner" },
    revision: catalogRevision,
  }];
  const catalogList = () => ({
    active: currentActive,
    options: currentOptions,
    revision: catalogRevision,
    versions: currentVersions,
    nextCursor: options.delayedCatalogPagination ? "delayed-cursor" : null,
    activations: catalogActivations,
  });
  const previewFor = (version: typeof activeWorkbook) => ({
    version,
    active: currentActive,
    revision: catalogRevision,
    diff: {
      addedDrivers: version.id === currentActive.id ? 0 : 1,
      removedDrivers: version.id === currentActive.id ? 0 : 2,
      changedDrivers: version.id === currentActive.id ? 0 : 3,
      addedSources: version.id === currentActive.id ? 0 : 1,
      removedSources: version.id === currentActive.id ? 0 : 1,
      addedSourceUrls: version.id === currentActive.id ? [] : ["https://example.com/new-source"],
      removedSourceUrls: version.id === currentActive.id ? [] : ["https://example.com/old-source"],
      changes: version.id === currentActive.id ? [] : [{
        kind: "changed",
        sheet: "Banking",
        driverName: "Board oversight",
        fields: ["Driver Logic", "Evidence/KPI"],
        before: { id: "old-board", sheet: "Banking", row: 14, section: "UAE", type: "Governance", name: "Board oversight", logic: "Old logic", evidenceKpi: "Old KPI", keySources: "Old source", sourceUrls: ["https://example.com/old-source"] },
        after: { id: "new-board", sheet: "Banking", row: 14, section: "UAE", type: "Governance", name: "Board oversight", logic: "New logic", evidenceKpi: "New KPI", keySources: "New source", sourceUrls: ["https://example.com/new-source"] },
      }],
      truncated: false,
    },
    warnings: version.id === currentActive.id ? [] : [{ sheet: "Banking", cell: "D14", message: "Source link retained from the previous version." }],
  });

  await page.route("**/api/esg/drivers/workbooks", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        ...previewFor(uploadedWorkbook),
        version: uploadedWorkbook,
      }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalogList()) });
  });
  if (options.delayedCatalogPagination) {
    await page.route("**/api/esg/drivers/workbooks?cursor=delayed-cursor", async (route) => {
      const stalePage = JSON.parse(JSON.stringify(catalogList()));
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stalePage) });
    });
  }
  await page.route("**/api/esg/drivers/workbooks/catalog-previous-v2", async (route) => {
    if (options.delayedHistoryPreview) {
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(previewFor(previousWorkbook)) });
  });
  await page.route("**/api/esg/drivers/workbooks/catalog-active-v3", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(previewFor(activeWorkbook)) });
  });
  await page.route("**/api/esg/drivers/workbooks/catalog-upload-v4/activate", async (route) => {
    expect(route.request().method()).toBe("POST");
    currentActive.isActive = false;
    uploadedWorkbook.isActive = true;
    currentActive = uploadedWorkbook;
    currentOptions = {
      ...catalogOptions,
      workbook: uploadedWorkbook.workbook,
      version: uploadedWorkbook.version,
      countries: [...catalogOptions.countries, "Qatar"],
      sectors: [...catalogOptions.sectors, "FinTech"],
      counts: { ...catalogOptions.counts, FinTech: { UAE: 18, Qatar: 22 } },
    };
    currentVersions = [uploadedWorkbook, activeWorkbook, previousWorkbook];
    catalogRevision += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalogList()) });
  });

  await page.route("**/api/esg/drivers/history?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobs: [],
        nextCursor: null,
        total: 0,
        completed: 0,
        needsAttention: 0,
      }),
    });
  });

  await page.route("**/api/esg/drivers/status?*", async (route) => {
    const jobId = new URL(route.request().url()).searchParams.get("jobId");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobId,
        status: "done",
        progress: 100,
        stage: "completed",
        error: null,
        activity: [],
      }),
    });
  });

  await page.route("**/api/esg/drivers/result?*", async (route) => {
    const jobId = new URL(route.request().url()).searchParams.get("jobId");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        result:
          resultByJob[jobId || ""] || (jobId === "child-job" ? childResult : parentResult),
        resumable:
          jobId === "parent-job" ||
          jobId === "ranked-gap-job" ||
          jobId === "ranked-partial-job" ||
          jobId === "ranked-date-job",
        ...(jobId === 'ranked-unscored-job' ? { resumable: true } : {}),
      }),
    });
  });

  await page.route("**/api/esg/drivers/parent-job/export", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": 'attachment; filename="partial-esg-drivers.xlsx"',
      },
      body: "mock workbook",
    });
  });

  await page.route("**/api/esg/drivers/parent-job/resume", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        jobId: "child-job",
        parentJobId: "parent-job",
        job: {
          id: "child-job",
          status: "queued",
          progress: 0,
          stage: "queued",
          activity: [],
        },
      }),
    });
  });

  await page.route("**/api/esg/drivers/ranked-gap-job/export", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": 'attachment; filename="ranked-esg-drivers.xlsx"',
      },
      body: "mock workbook",
    });
  });

  await page.route("**/api/esg/drivers/ranked-gap-job/resume", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        jobId: "ranked-child-job",
        parentJobId: "ranked-gap-job",
        job: {
          id: "ranked-child-job",
          status: "queued",
          progress: 0,
          stage: "queued",
          activity: [],
          selectionPolicy: "relevance-top15-v1",
          candidateCount: 52,
          expectedDriverCount: 15,
        },
      }),
    });
  });
}

test("renders all 52 workbook drivers in Excel order", async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);

  await page.goto("/esg/tools?tool=drivers&jobId=child-job");

  await expect(
    page.getByRole("heading", { level: 1, name: "UAE / Banking" }),
  ).toBeVisible();
  await expect(page.getByText("Driver 1 of 52")).toBeVisible();
  await expect(page.getByText('Historical evidence · 2016').first()).toBeVisible();
  await expect(page.getByText('Historical study; current banking outcomes are not established.').first()).toBeVisible();
  await expect(page.getByText("Updates need attention:")).toHaveCount(0);
});

test("exports a partial pack and completes it through an immutable child retry", async ({
  page,
}) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);

  await page.goto("/esg/tools?tool=drivers&jobId=parent-job");

  await expect(page.getByText("Updates need attention:")).toBeVisible();
  await expect(page.getByText(/50 of 52 drivers have source-supported updates\./)).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("partial-esg-drivers.xlsx");

  await page.getByRole("button", { name: "Retry unavailable updates" }).click();
  await expect(page).toHaveURL(/jobId=child-job/);
  await expect(page.getByText("Driver 1 of 52")).toBeVisible();
  await expect(page.getByText("Updates need attention:")).toHaveCount(0);
});


test('offers workbook countries/sectors and previews the exact count', async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  await page.goto('/esg/tools?tool=drivers&view=new');
  await expect(page.getByLabel('Country').locator('option')).toHaveText(['Kazakhstan', 'Uzbekistan', 'UAE', 'Saudi Arabia']);
  await expect(page.getByLabel('Sector').locator('option')).toHaveText(['Banking', 'Energy', 'Oil & Gas', 'Mining & Metals', 'Real Estate']);
  await expect(page.getByText(/Up to 15 ranked drivers are published from 52 workbook candidates/)).toBeVisible();
  if (process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await page.screenshot({ path: "../../docs/audits/esg-drivers-2026-09-09/ui-setup.png", fullPage: true });
  await page.getByLabel('Country').selectOption('Uzbekistan');
  await page.getByLabel('Sector').selectOption('Energy');
  await page.getByLabel('Language').selectOption('Russian');
  await expect(page.getByText(/Up to 15 ranked drivers are published from 40 workbook candidates/)).toBeVisible();
});

test("pins new generation to the active workbook version", async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  let generationBody: Record<string, unknown> | null = null;
  await page.route("**/api/esg/drivers/generate", async (route) => {
    generationBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ jobId: "generated-job", job: { status: "queued", progress: 0, stage: "queued", activity: [] } }) });
  });
  await page.goto("/esg/tools?tool=drivers&view=new");
  await page.getByLabel("Country").selectOption("Uzbekistan");
  await page.getByLabel("Sector").selectOption("Energy");
  await page.getByRole("button", { name: "Generate driver pack" }).click();
  await expect.poll(() => generationBody).toMatchObject({ country: "Uzbekistan", sector: "Energy", expectedWorkbookVersion: "2026-09-09-v3" });
});

test("validates an uploaded workbook without activating it", async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  const activationRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/activate")) activationRequests.push(request.url());
  });
  await page.goto("/esg/tools?tool=drivers&view=new");
  await page.getByRole("button", { name: "Manage driver workbook" }).click();
  await expect(page.getByRole("dialog", { name: "Manage driver workbooks" })).toBeVisible();
  await page.getByLabel("Workbook file").setInputFiles({
    name: "candidate.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("values-only workbook"),
  });
  await page.getByRole("button", { name: "Validate workbook" }).click();
  await expect(page.getByText("Upload preview · draft")).toBeVisible();
  await expect(page.getByText("Drivers changed")).toBeVisible();
  await expect(page.getByText("Old logic")).toBeVisible();
  await expect(page.getByText("New logic")).toBeVisible();
  await expect(page.getByText("Source link retained from the previous version.")).toBeVisible();
  await expect(page.getByText(/Limits: names\/types 160 characters/)).toBeVisible();
  if (process.env.ESG_DRIVERS_ISOLATED_UI_TEST) {
    const previewPanel = page
      .getByText("Upload preview · draft", { exact: true })
      .locator("xpath=ancestor::section[1]");
    await previewPanel.screenshot({
      path: "../../docs/audits/esg-drivers-2026-09-09/ui-workbook-manager.png",
    });
  }
  expect(activationRequests).toHaveLength(0);
});

test("traps workbook manager focus and restores focus after confirmation and close", async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  await page.goto("/esg/tools?tool=drivers&view=new");

  const opener = page.getByRole("button", { name: "Manage driver workbook" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Manage driver workbooks" });
  const closeButton = dialog.getByRole("button", { name: "Close workbook manager" });
  await expect(dialog).toBeVisible();
  await expect(closeButton).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();

  await page.getByLabel("Workbook file").setInputFiles({
    name: "candidate.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("values-only workbook"),
  });
  await page.getByRole("button", { name: "Validate workbook" }).click();
  await page.getByRole("button", { name: "Review activation" }).click();
  const activationDialog = page.getByRole("alertdialog", { name: "Activate this shared workbook?" });
  const activateButton = activationDialog.getByRole("button", { name: "Activate shared workbook" });
  await expect(activationDialog).toBeVisible();
  await expect(activateButton).toBeFocused();

  await activationDialog.getByRole("button", { name: "Keep reviewing" }).click();
  await expect(dialog.getByRole("button", { name: "Review activation" })).toBeFocused();

  await closeButton.click();
  await expect(opener).toBeFocused();
});

test("requires explicit activation and sends the active revision", async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  let activationBody: Record<string, unknown> | null = null;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("catalog-upload-v4/activate")) {
      activationBody = request.postDataJSON() as Record<string, unknown>;
    }
  });
  await page.goto("/esg/tools?tool=drivers&view=new");
  await page.getByRole("button", { name: "Manage driver workbook" }).click();
  await page.getByLabel("Workbook file").setInputFiles({ name: "candidate.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("values-only workbook") });
  await page.getByRole("button", { name: "Validate workbook" }).click();
  await page.getByRole("button", { name: "Review activation" }).click();
  await expect(page.getByText(/everyone's new jobs/)).toBeVisible();
  await expect(page.getByText(/Running jobs, retried jobs, and saved jobs/)).toBeVisible();
  await page.getByRole("button", { name: "Activate shared workbook" }).click();
  await expect.poll(() => activationBody).toEqual({ expectedRevision: 7 });
  await page.getByRole("button", { name: "Close workbook manager" }).click();
  await page.getByLabel("Country").selectOption("Qatar");
  await expect(page.getByLabel("Country")).toHaveValue("Qatar");
  await page.getByLabel("Sector").selectOption("FinTech");
  await expect(page.getByLabel("Sector")).toHaveValue("FinTech");
});

test("does not let delayed catalog pagination overwrite an activation", async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page, { delayedCatalogPagination: true });
  await page.goto("/esg/tools?tool=drivers&view=new");

  await page.getByRole("button", { name: "Manage driver workbook" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage driver workbooks" });
  await dialog.getByRole("button", { name: "Load older versions" }).click();

  await dialog.getByLabel("Workbook file").setInputFiles({
    name: "candidate.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("values-only workbook"),
  });
  await dialog.getByRole("button", { name: "Validate workbook" }).click();
  await dialog.getByRole("button", { name: "Review activation" }).click();
  await dialog.getByRole("button", { name: "Activate shared workbook" }).click();
  await expect(dialog.getByText("ESG_Drivers_September_new.xlsx").first()).toBeVisible();

  await page.waitForTimeout(1100);
  await expect(dialog.getByText("ESG_Drivers_September_new.xlsx").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Close workbook manager" }).click();
  await page.getByLabel("Country").selectOption("Qatar");
  await page.getByLabel("Sector").selectOption("FinTech");
  await expect(page.getByLabel("Country")).toHaveValue("Qatar");
  await expect(page.getByLabel("Sector")).toHaveValue("FinTech");
});

test("previews an older workbook for rollback through the same confirmation", async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  await page.goto("/esg/tools?tool=drivers");
  await page.getByRole("button", { name: "Manage driver workbook" }).click();
  await page.getByRole("button", { name: "Preview" }).last().click();
  await expect(page.getByText("History preview")).toBeVisible();
  await expect(page.getByText("ESG_Drivers_August.xlsx").first()).toBeVisible();
  await page.getByRole("button", { name: "Review activation" }).click();
  await expect(page.getByText(/Activate this shared workbook/)).toBeVisible();
  await expect(page.getByText(/everyone's new jobs/)).toBeVisible();
});

test("discards a slow history preview after the manager closes", async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page, { delayedHistoryPreview: true });
  await page.goto("/esg/tools?tool=drivers");

  const opener = page.getByRole("button", { name: "Manage driver workbook" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Manage driver workbooks" });
  const previewRequest = page.waitForRequest(
    (request) => request.method() === "GET" && request.url().includes("catalog-previous-v2"),
  );
  await dialog.getByRole("button", { name: "Preview" }).last().click();
  await previewRequest;

  await dialog.getByRole("button", { name: "Close workbook manager" }).click();
  await expect(dialog).toHaveCount(0);
  await page.waitForTimeout(1100);

  await opener.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("History preview", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "ESG_Drivers_September.xlsx" })).toBeVisible();
});

test("shows a stale activation message and never regenerates a job", async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  await page.route("**/api/esg/drivers/workbooks/catalog-upload-v4/activate", async (route) => {
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Workbook revision is stale." }) });
  });
  const generateRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/esg/drivers/generate")) generateRequests.push(request.url());
  });
  await page.goto("/esg/tools?tool=drivers&view=new");
  await page.getByRole("button", { name: "Manage driver workbook" }).click();
  await page.getByLabel("Workbook file").setInputFiles({ name: "candidate.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("values-only workbook") });
  await page.getByRole("button", { name: "Validate workbook" }).click();
  await page.getByRole("button", { name: "Review activation" }).click();
  await page.getByRole("button", { name: "Activate shared workbook" }).click();
  await expect(page.getByText(/changed while you were reviewing it/)).toBeVisible();
  expect(generateRequests).toHaveLength(0);
});

test("rejects an invalid workbook before sending an upload request", async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  const uploadRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/esg/drivers/workbooks")) uploadRequests.push(request.url());
  });
  await page.goto("/esg/tools?tool=drivers");
  await page.getByRole("button", { name: "Manage driver workbook" }).click();
  await page.getByLabel("Workbook file").setInputFiles({ name: "candidate.pdf", mimeType: "application/pdf", buffer: Buffer.from("not an xlsx") });
  await expect(page.getByText(/Choose an .xlsx workbook/)).toBeVisible();
  expect(uploadRequests).toHaveLength(0);
});

test('shows 52 processing rows and restores scope on direct navigation', async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  const rows = makeDrivers(52);
  await page.route('**/api/esg/drivers/status?*', (route) => route.fulfill({ json: { jobId: 'working-job', country: 'UAE', sector: 'Banking', language: 'Arabic', status: 'processing', progress: 40, stage: 'Checking driver 22/52', activity: [], driverPlan: rows.map((d, i) => ({ id: d.id, number: i + 1, title: d.driverTitle, section: d.driverSection })) } }));
  await page.goto('/esg/tools?tool=drivers&jobId=working-job');
  await expect(page.getByText('Arabic', { exact: true })).toBeVisible();
  await expect(page.getByText('0/52', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(rows[51].driverTitle, { exact: true })).toBeVisible();
});

test('shows an explicit empty saved-result state', async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  await page.route('**/api/esg/drivers/result?*', (route) => route.fulfill({ json: { success: true, result: { ...makeResult('partial'), drivers: [], verifiedDriverCount: 0 }, resumable: false } }));
  await page.goto('/esg/tools?tool=drivers&jobId=empty-job');
  await expect(page.getByText('This saved pack contains no drivers. Start a new workbook run.')).toBeVisible();
});

test('starts a valid workbook selection when creating a new pack from a legacy sector', async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  await page.route('**/api/esg/drivers/result?*', (route) => route.fulfill({ json: { success: true, result: { ...makeResult('complete'), country: 'United Arab Emirates', sector: 'Construction', workflow: undefined }, resumable: false } }));
  await page.goto('/esg/tools?tool=drivers&jobId=legacy-job');
  await expect(page.getByText(/This saved pack uses an earlier catalog/)).toBeVisible();
  await page.getByRole('button', { name: 'New driver', exact: true }).click();
  await expect(page.getByLabel('Country')).toHaveValue('UAE');
  await expect(page.getByLabel('Sector')).toHaveValue('Banking');
  await expect(page.getByText(/Up to 15 ranked drivers are published from 52 workbook candidates/)).toBeVisible();
});


test('renders Arabic narrative and distinguishes undated sources from retrieval dates', async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  const result = makeResult('complete');
  result.language = 'Arabic';
  const narrative = 'يوفّر هذا الإطار أساساً لتحليل مخاطر الاستدامة وفرصها في القطاع المصرفي.';
  const excerpt = 'توضح هذه الوثيقة أهداف الاستدامة ومتطلبات الإفصاح وآثارها المحتملة على القطاع المصرفي في الدولة.';
  result.drivers[0].driverText = narrative;
  const source = result.evidence[0] as unknown as Record<string, unknown>;
  source.contentSnippet = excerpt; source.snippet = excerpt;
  source.publishedDate = null; source.updatedDate = null; source.lastModified = null;
  await page.route('**/api/esg/drivers/result?*', (route) => route.fulfill({ json: { success: true, result, resumable: false } }));
  await page.goto('/esg/tools?tool=drivers&jobId=arabic-job');
  await expect(page.getByText(narrative, { exact: true })).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: 'Show parsed evidence', exact: true }).click();
  await expect(page.getByText(excerpt, { exact: true })).toBeVisible();
  await expect(page.getByText(/Publication date not stated/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Paris Agreement', exact: true })).toBeVisible();
  if (process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await page.screenshot({ path: "../../docs/audits/esg-drivers-2026-09-09/ui-arabic.png", fullPage: true });
});

test('renders the stored ranked Top 15 order with explainable relevance scores', async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  await page.goto('/esg/tools?tool=drivers&jobId=ranked-job');

  await expect(page.getByText('Rank 1 of 15')).toBeVisible();
  await expect(page.getByText(/15 of 15 requested drivers published from 52 workbook candidates/)).toBeVisible();
  await expect(page.getByTestId(/driver-slide-/)).toHaveCount(15);
  await expect(page.getByTestId(`driver-slide-${makeRankedResult(15, 0).drivers[0].id}`)).toContainText('96/100');
  await expect(page.getByText(/confidence/i)).toHaveCount(0);

  await page.getByText(/Why selected · relevance score 96\/100/).first().click();
  await expect(page.getByText('Business impact', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('20/25 pts', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Rating 4\/5 · 4 × 25 ÷ 5/).first()).toBeVisible();

  const candidatePoolTitle = makeRankedResult(15, 0).candidatePool[20].driverTitle;
  await expect(page.getByText(candidatePoolTitle, { exact: true })).toHaveCount(0);
});

test('keeps ranked retry available when 15 published drivers have unavailable candidates', async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  await page.goto('/esg/tools?tool=drivers&jobId=ranked-gap-job');

  await expect(page.getByText(/15 of 15 requested drivers published from 52 workbook candidates/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry unavailable updates' })).toBeVisible();
  await page.getByText('Candidate assessment coverage · 37 excluded').click();
  await expect(page.getByText(/Unsupported topic retained in audit:/).first()).toBeVisible();
  await expect(page.getByText(/Research gap reason: No direct source-supported update was available\./).first()).toBeVisible();
  await page.getByRole('button', { name: 'Retry unavailable updates' }).click();
  await expect(page).toHaveURL(/jobId=ranked-child-job/);
  await expect(page.getByText('Rank 1 of 15')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry unavailable updates' })).toHaveCount(0);
});

test('distinguishes a ranked partial report from its full candidate assessment', async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  await page.goto('/esg/tools?tool=drivers&jobId=ranked-partial-job');

  await expect(page.getByText(/12 of 15 requested drivers published from 52 workbook candidates/)).toBeVisible();
  await expect(page.getByText('Rank 1 of 12')).toBeVisible();
  await expect(page.getByTestId(/driver-slide-/)).toHaveCount(12);
  await expect(page.getByRole('button', { name: 'Retry unavailable updates' })).toBeVisible();
});

test('keeps a rejected score out of the 15-driver report and exposes its review reason', async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  await page.goto('/esg/tools?tool=drivers&jobId=ranked-unscored-job');
  await expect(page.getByTestId(/driver-slide-/)).toHaveCount(15);
  await expect(page.getByRole('button', { name: 'Retry assessment gaps' })).toBeVisible();
  await page.getByText('Candidate assessment coverage · 37 excluded').click();
  await expect(page.getByText('Relevance review reason: The proposed score borrowed a deadline from another regulation.')).toBeVisible();
  await expect(page.getByText('Research gap reason: The proposed score borrowed a deadline from another regulation.')).toHaveCount(0);
});

test('uses source publication evidence and keeps HTTP metadata separate', async ({ page }) => {
  if (!process.env.ESG_DRIVERS_ISOLATED_UI_TEST) await authenticateE2eUser(page);
  await mockDriverApis(page);
  await page.goto('/esg/tools?tool=drivers&jobId=ranked-date-job');

  const evidenceButtons = page.getByRole('button', { name: 'Show parsed evidence', exact: true });
  await expect(evidenceButtons).toHaveCount(2);
  await evidenceButtons.nth(0).click();
  await expect(page.getByText(/Published June 2026/)).toBeVisible();
  await expect(page.getByText(/Date evidence: “Published June 2026” · cover page/)).toBeVisible();
  await evidenceButtons.nth(0).click();
  await expect(page.getByText(/Publication date not stated/)).toBeVisible();
  await expect(page.getByText(/HTTP modified/)).toHaveCount(0);
});
