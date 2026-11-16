import { expect, test, type Page } from "@playwright/test";

type Domain = "esg" | "credit";
type SelectionState = "selected" | "confirmed" | "dismissed";

const TARGET_WEEK = "2026-11-16";

type WeeklyStatus =
  | "queued"
  | "manifesting"
  | "assessing_history"
  | "merging_history"
  | "evaluating_candidates"
  | "merging_candidates"
  | "ready"
  | "error"
  | "budget_exhausted"
  | "insufficient_history"
  | "expired"
  | "cancelled";

function weeklySummary(
  domain: Domain,
  overrides: Record<string, unknown> = {},
  coverageOverrides: Record<string, unknown> = {},
) {
  const historyTotal = domain === "esg" ? 20 : 8;
  const candidateTotal = 12;
  return {
    targetWeekKey: TARGET_WEEK,
    sourceStart: "2026-11-09T00:00:00+04:00",
    sourceEnd: "2026-11-14T00:00:00+04:00",
    processingAt: "2026-11-14T00:15:00+04:00",
    emailAt: "2026-11-16T09:00:00+04:00",
    validUntil: "2026-11-23T00:00:00+04:00",
    timezone: "Asia/Dubai",
    model: "gpt-6-luna",
    status: "ready" as WeeklyStatus,
    phase: "finalize",
    coverage: {
      historyTotal,
      historyResolved: historyTotal - 2,
      historyProcessed: historyTotal - 2,
      historyUnusable: 2,
      historyExcluded: 2,
      candidateTotal,
      candidateProcessed: candidateTotal - 3,
      candidateUnusable: 3,
      candidateExcluded: 3,
      candidateCarryover: 2,
      mergeLeaves: 4,
      mergeNodes: 2,
      mergeNodesCompleted: 2,
      status: "complete",
      ...coverageOverrides,
    },
    selectionCount: 1,
    completedAt: "2026-11-14T00:22:00+04:00",
    assessmentSummary: `${domain.toUpperCase()} weekly profile reviewed shared history and candidate inputs.`,
    ...overrides,
  };
}

const selectionFor = (domain: Domain, articleId: number, overrides: Record<string, unknown> = {}) => ({
  articleId,
  domain,
  state: "selected" as SelectionState,
  reason: domain === "esg" ? "Matches shared ESG liked-article history." : "Matches shared Credit liked-article history.",
  version: 1,
  selectedAt: "2026-11-13T20:22:00.000Z",
  expiresAt: "2026-11-22T20:00:00.000Z",
  pendingConfirmation: false,
  sharedSelectionId: `00000000-0000-4000-8000-${String(articleId).padStart(12, "0")}`,
  assessmentDate: "2026-11-16",
  policyVersion: 3,
  targetWeekKey: TARGET_WEEK,
  ...overrides,
});

function preference(domain: Domain, overrides: Record<string, unknown> = {}) {
  return {
    domain,
    enabled: true,
    settingsVersion: 1,
    historyCount: domain === "esg" ? 20 : 8,
    profileSource: "domain",
    weeklyDigestConfigured: domain === "credit",
    status: "ready",
    lastRunAt: "2026-11-16T08:00:00.000Z",
    emailInclusionEnabled: domain === "esg",
    weekly: weeklySummary(domain),
    scheduleMismatch: false,
    ...overrides,
  };
}

async function mockArticleAiApis(
  page: Page,
  options: {
    selectionFailureOnce?: boolean;
    conflictFirst?: boolean;
    delayEsgSelectionMs?: number;
    delayFeedbackMs?: number;
    delayedFeedbackArticleId?: number;
    resolveCreditPending?: boolean;
    includePendingEsg?: boolean;
    sharedHistoryCount?: number;
    sharedHistoryReady?: boolean;
    esgEnabled?: boolean;
    esgWeeklyDigestConfigured?: boolean;
    esgEmailInclusionEnabled?: boolean;
    creditWeeklyDigestConfigured?: boolean;
    creditEmailInclusionEnabled?: boolean;
    scheduleMismatch?: boolean;
    weeklyStatus?: WeeklyStatus;
    weeklyReadyZero?: boolean;
    weeklyPartial?: boolean;
    weeklyError?: boolean;
  } = {},
) {
  const sharedHistoryCount = options.sharedHistoryCount ?? 20;
  const sharedHistoryReady = options.sharedHistoryReady !== false;
  const weeklyStatus = options.weeklyError
    ? "error"
    : options.weeklyReadyZero
      ? "ready"
      : options.weeklyStatus ?? (sharedHistoryReady ? "ready" : "insufficient_history");
  const weeklyCoverageStatus = options.weeklyPartial || weeklyStatus !== "ready" ? "incomplete" : "complete";
  const prefs: Record<Domain, any> = {
    esg: preference("esg", {
      historyCount: sharedHistoryCount,
      profileSource: "domain",
      status: sharedHistoryReady ? "ready" : "insufficient_history",
      weeklyDigestConfigured: options.esgWeeklyDigestConfigured ?? false,
      emailInclusionEnabled: options.esgEmailInclusionEnabled ?? true,
      scheduleMismatch: options.scheduleMismatch ?? false,
      weekly: weeklySummary(
        "esg",
        {
          status: weeklyStatus,
          selectionCount: options.weeklyReadyZero ? 0 : 1,
          ...(options.weeklyReadyZero ? { assessmentSummary: "This completed pass found no candidates strong enough to select." } : {}),
        },
        {
          historyTotal: sharedHistoryCount,
          historyResolved: Math.max(0, sharedHistoryCount - 2),
          historyProcessed: Math.max(0, sharedHistoryCount - (options.weeklyPartial ? 4 : 2)),
          status: weeklyCoverageStatus,
          ...(options.weeklyPartial ? { candidateProcessed: 4, candidateExcluded: 1 } : {}),
        },
      ),
      ...(options.esgEnabled === undefined ? {} : {
        enabled: options.esgEnabled,
        status: options.esgEnabled ? "ready" : "off",
      }),
    }),
    credit: preference("credit", {
      weeklyDigestConfigured: options.creditWeeklyDigestConfigured ?? true,
      emailInclusionEnabled: options.creditEmailInclusionEnabled ?? false,
      scheduleMismatch: options.scheduleMismatch ?? false,
      weekly: weeklySummary("credit", {
        status: weeklyStatus,
        selectionCount: options.weeklyReadyZero ? 0 : 1,
        ...(options.weeklyReadyZero ? { assessmentSummary: "This completed pass found no candidates strong enough to select." } : {}),
      }, {
        status: weeklyCoverageStatus,
      }),
    }),
  };
  const selections: Record<Domain, any[]> = {
    esg: options.weeklyReadyZero
      ? []
      : options.includePendingEsg
      ? [selectionFor("esg", 101), selectionFor("esg", 102, { pendingConfirmation: true })]
      : [selectionFor("esg", 101)],
    credit: options.weeklyReadyZero
      ? []
      : options.resolveCreditPending
      ? [selectionFor("credit", 201), selectionFor("credit", 202, { pendingConfirmation: true })]
      : [selectionFor("credit", 201)],
  };
  const selectionCalls: Record<Domain, number> = { esg: 0, credit: 0 };
  const feedbackRequests: Array<Record<string, unknown>> = [];
  let selectionFailureRemaining = options.selectionFailureOnce ? 1 : 0;
  let conflictRemaining = options.conflictFirst ? 1 : 0;

  await page.route("**/api/article-ai/preferences**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const domain = (new URL(request.url()).searchParams.get("domain") ?? "esg") as Domain;
      await route.fulfill({ json: prefs[domain] });
      return;
    }
    if (request.method() === "PATCH") {
      const body = request.postDataJSON() as { domain: Domain; enabled: boolean };
      prefs[body.domain] = {
        ...prefs[body.domain],
        enabled: body.enabled,
      };
      await route.fulfill({ json: prefs[body.domain] });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/article-ai/selections**", async (route) => {
    const domain = (new URL(route.request().url()).searchParams.get("domain") ?? "esg") as Domain;
    selectionCalls[domain] += 1;
    if (domain === "esg" && options.delayEsgSelectionMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayEsgSelectionMs));
    }
    if (selectionFailureRemaining > 0) {
      selectionFailureRemaining -= 1;
      await route.fulfill({ status: 500, json: { error: "Selection service unavailable." } });
      return;
    }
    const responseSelections = selections[domain].map((selection) =>
      options.resolveCreditPending && domain === "credit" && selection.articleId === 202 && selectionCalls.credit >= 2
        ? { ...selection, state: "confirmed", pendingConfirmation: false }
        : selection,
    );
    await route.fulfill({ json: { selections: responseSelections } });
  });

  await page.route("**/api/article-ai/feedback", async (route) => {
    const body = route.request().postDataJSON() as {
      domain: Domain;
      articleId: number;
      action: "confirm" | "dismiss";
      expectedVersion: number;
      sharedSelectionId: string;
      targetWeekKey?: string;
    };
    feedbackRequests.push(body);
    const current = selections[body.domain].find((selection) => selection.articleId === body.articleId);
    if (!body.sharedSelectionId || body.sharedSelectionId !== current?.sharedSelectionId) {
      await route.fulfill({ status: 400, json: { error: "Shared selection identity is required." } });
      return;
    }
    if (body.targetWeekKey && body.targetWeekKey !== current?.targetWeekKey) {
      await route.fulfill({ status: 409, json: { error: "Selection week is stale." } });
      return;
    }
    if (
      options.delayFeedbackMs &&
      body.articleId === (options.delayedFeedbackArticleId ?? 101)
    ) {
      await new Promise((resolve) => setTimeout(resolve, options.delayFeedbackMs));
    }
    if (conflictRemaining > 0 && body.articleId === 101) {
      conflictRemaining -= 1;
      await route.fulfill({ status: 409, json: { error: "Selection version is stale." } });
      return;
    }
    const next = {
      ...(current ?? selectionFor(body.domain, body.articleId)),
      state: body.action === "confirm" ? "confirmed" : "dismissed",
      version: body.expectedVersion + 1,
      pendingConfirmation: false,
    };
    selections[body.domain] = selections[body.domain]
      .filter((selection) => selection.articleId !== body.articleId)
      .concat(next);
    await route.fulfill({
      json: {
        selection: next,
        humanLiked: body.action === "confirm",
        pending: false,
      },
    });
  });

  return { selectionCalls, feedbackRequests };
}

test("keeps ESG and Credit switches independent, batches selections, and preserves filters", async ({ page }) => {
  const { selectionCalls } = await mockArticleAiApis(page);
  await page.goto("/articles?source=Regulator&date=2026-11-16");

  await expect(page.getByTestId("article-ai-controls-esg")).toBeVisible();
  await expect(page.getByTestId("article-ai-controls-credit").first()).toBeVisible();
  await expect(page.getByText(/configure an existing weekly article email for this domain/)).toBeVisible();
  await expect(page.getByText("AI email inclusion is currently unavailable here.")).toBeVisible();
  await expect(page.getByTestId("article-ai-weekly-status-esg")).toContainText("Ready for the Monday email");
  await expect(page.getByTestId("article-ai-weekly-status-credit")).toContainText("Ready for the Monday email");
  expect(selectionCalls).toEqual({ esg: 1, credit: 1 });

  const esgSwitch = page.getByTestId("article-ai-toggle-esg");
  const creditSwitch = page.getByTestId("article-ai-toggle-credit").first();
  await esgSwitch.focus();
  await page.keyboard.press("Space");
  await expect(esgSwitch).toHaveAttribute("aria-checked", "false");
  await expect(creditSwitch).toHaveAttribute("aria-checked", "true");
  await expect(page).toHaveURL(/\/articles\?source=Regulator&date=2026-11-16$/);
  await expect(esgSwitch).toBeFocused();
  await page.screenshot({ path: "test-results/article-ai-ui-esg-credit.png", fullPage: true });
});

test("describes shared domain history without requiring personal likes", async ({ page }) => {
  await mockArticleAiApis(page, { sharedHistoryCount: 7 });
  await page.goto("/articles");

  const esgControls = page.getByTestId("article-ai-controls-esg");
  await expect(esgControls.getByText("The shared ESG profile learns from all human-liked articles in this domain. Your switch controls only whether shared picks appear in your private weekly email.")).toBeVisible();
  await expect(esgControls.getByText(/personal likes/)).toHaveCount(0);
});

test("keeps shared picks visible when private email inclusion is off", async ({ page }) => {
  await mockArticleAiApis(page, { esgEnabled: false });
  await page.goto("/articles");

  const esgControls = page.getByTestId("article-ai-controls-esg");
  await expect(esgControls.getByTestId("article-ai-toggle-esg")).toHaveAttribute("aria-checked", "false");
  await expect(esgControls).toContainText("Shared AI picks remain visible here");
  await expect(esgControls.getByTestId("article-ai-weekly-esg")).toBeVisible();
  const sharedPick = page.getByTestId("article-ai-selection-101");
  await expect(sharedPick).toBeVisible();
  await expect(sharedPick.getByRole("button", { name: "Keep & like" })).toBeVisible();
  await expect(sharedPick.getByRole("button", { name: "Dismiss" })).toBeVisible();
});

test("handles dismiss, confirmation, pending state, and a stale feedback version", async ({ page }) => {
  await mockArticleAiApis(page, { conflictFirst: true, includePendingEsg: true });
  await page.goto("/articles");

  const pending = page.getByTestId("article-ai-selection-102");
  await expect(pending.getByText("Saving your AI pick…")).toBeVisible();
  await expect(pending.getByRole("button", { name: "Dismiss" })).toBeDisabled();

  const esgPick = page.getByTestId("article-ai-selection-101");
  await esgPick.getByRole("button", { name: "Dismiss" }).click();
  await expect(esgPick.getByRole("alert")).toContainText("changed");
  await esgPick.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByTestId("article-ai-selection-101")).toHaveCount(0);

  const creditPick = page.getByTestId("article-ai-selection-201");
  await creditPick.getByRole("button", { name: "Keep & like" }).click();
  await expect(creditPick).toContainText("AI pick confirmed for your digest");
  await expect(creditPick).toContainText("shared picks");
});

test("recovers from selection loading errors and shows signed-out guidance", async ({ page }) => {
  await mockArticleAiApis(page, { selectionFailureOnce: true });
  await page.goto("/articles");

  await expect(page.getByText("Selection service unavailable.")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).first().click();
  await expect(page.getByTestId("article-ai-selection-101")).toBeVisible();
  await expect(page.getByText("Sign in to choose whether shared AI picks appear in your private weekly email digest.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to manage digest picks" })).toHaveAttribute("href", "/signin");
});

test("polls pending confirmations and refreshes the server like count", async ({ page }) => {
  await mockArticleAiApis(page, { resolveCreditPending: true });
  await page.goto("/articles");

  const pending = page.getByTestId("article-ai-selection-202");
  await expect(pending.getByText("Saving your AI pick…")).toBeVisible();
  await expect(pending).toContainText("AI pick confirmed for your digest", { timeout: 8_000 });
  await expect(
    page.getByTestId("domain-panel-credit-signed-in").getByTestId("server-like-count-202"),
  ).toHaveText(/[1-9]/);
});

test("does not let a delayed ESG response overwrite a Credit navigation", async ({ page }) => {
  await mockArticleAiApis(page, { delayEsgSelectionMs: 900 });
  await page.goto("/articles?focus=1");
  const focus = page.getByTestId("focus-switcher");
  await expect(focus.getByTestId("article-ai-controls-esg")).toBeVisible();
  await focus.getByRole("button", { name: "Navigate to Credit" }).click();
  await expect(focus.getByTestId("article-ai-controls-credit")).toBeVisible();
  await expect(focus.getByTestId("article-ai-selection-201")).toBeVisible();
  await page.waitForTimeout(1_100);
  await expect(focus.getByTestId("article-ai-selection-201")).toBeVisible();
  await expect(focus.getByTestId("article-ai-selection-101")).toHaveCount(0);
});

test("does not apply delayed feedback after navigating from ESG to Credit", async ({ page }) => {
  await mockArticleAiApis(page, { delayFeedbackMs: 900, delayedFeedbackArticleId: 101 });
  await page.goto("/articles?focus=1");
  const focus = page.getByTestId("focus-switcher");
  const esgPick = focus.getByTestId("article-ai-selection-101");
  await esgPick.getByRole("button", { name: "Keep & like" }).click();
  await focus.getByRole("button", { name: "Navigate to Credit" }).click();
  await expect(focus.getByTestId("article-ai-controls-credit")).toBeVisible();
  await page.waitForTimeout(1_100);
  await expect(focus.getByTestId("article-ai-selection-201")).toBeVisible();
  await expect(focus.getByTestId("article-ai-selection-101")).toHaveCount(0);
});

test("shows the fixed Dubai schedule and upcoming weekly window for both domains", async ({ page }) => {
  await mockArticleAiApis(page);
  await page.goto("/articles");

  for (const domain of ["esg", "credit"] as const) {
    const weekly = page.getByTestId(`article-ai-weekly-${domain}`);
    await expect(weekly).toContainText("Target week");
    await expect(weekly).toContainText("Nov 16, 2026");
    await expect(weekly).toContainText("Nov 9, 2026");
    await expect(weekly).toContainText("Nov 13, 2026");
    await expect(weekly).toContainText("Saturday at 12:15 am Dubai");
    await expect(weekly).toContainText("Monday at 9:00 am Dubai");
    await expect(weekly).toContainText("gpt-6-luna");
  }
});

test("reports partial review coverage, exclusions, carryover, and completion limits", async ({ page }) => {
  await mockArticleAiApis(page, {
    weeklyStatus: "evaluating_candidates",
    weeklyPartial: true,
  });
  await page.goto("/articles");

  const weekly = page.getByTestId("article-ai-weekly-esg");
  await expect(weekly.getByTestId("article-ai-weekly-status-esg")).toContainText("Reviewing current candidates");
  await expect(weekly.getByTestId("article-ai-weekly-coverage-esg")).toContainText("16 of 20 history inputs");
  await expect(weekly.getByTestId("article-ai-weekly-coverage-esg")).toContainText("4 of 12 candidates");
  await expect(weekly.getByTestId("article-ai-weekly-coverage-esg")).toContainText("2 history · 1 candidates");
  await expect(weekly.getByTestId("article-ai-weekly-coverage-esg")).toContainText("2 candidates");
  await expect(weekly).toContainText("do not claim that every input was reviewed");
  await expect(weekly).not.toContainText("Reviewed 20 of 20 history inputs and 12 of 12 candidates.");
});

test("shows a completed weekly pass with zero shared selections", async ({ page }) => {
  await mockArticleAiApis(page, { weeklyReadyZero: true });
  await page.goto("/articles");
  const readyZero = page.getByTestId("article-ai-weekly-esg");
  await expect(readyZero.getByTestId("article-ai-weekly-status-esg")).toContainText("Ready for the Monday email");
  await expect(readyZero).toContainText("completed without selecting a shared pick");
  await expect(page.getByTestId("article-ai-selection-101")).toHaveCount(0);
});

test("shows a failed weekly outcome without claiming complete input review", async ({ page }) => {
  await mockArticleAiApis(page, { weeklyError: true });
  await page.goto("/articles");
  const failed = page.getByTestId("article-ai-weekly-esg");
  await expect(failed.getByTestId("article-ai-weekly-status-esg")).toContainText("Weekly assessment needs attention");
  await expect(failed).toContainText("do not claim that every input was reviewed");
  await expect(failed).not.toContainText("Ready for the Monday email");
});

test("explains a missing subscription without changing it", async ({ page }) => {
  await mockArticleAiApis(page, { esgWeeklyDigestConfigured: false });
  await page.goto("/articles");
  const missing = page.getByTestId("article-ai-controls-esg");
  await expect(missing).toContainText("configure an existing weekly article email");
  await expect(missing).toContainText("will not create or change that subscription");
});

test("explains a mismatched subscription schedule", async ({ page }) => {
  await mockArticleAiApis(page, {
    esgWeeklyDigestConfigured: true,
    scheduleMismatch: true,
    esgEmailInclusionEnabled: true,
  });
  await page.goto("/articles");
  const mismatched = page.getByTestId("article-ai-controls-esg");
  await expect(mismatched).toContainText("uses a different schedule");
  await expect(mismatched).toContainText("will not silently change it");
});

test("sends the exact shared UUID and weekly key with feedback", async ({ page }) => {
  const { feedbackRequests } = await mockArticleAiApis(page, { esgEmailInclusionEnabled: true });
  await page.goto("/articles");

  const pick = page.getByTestId("article-ai-selection-101");
  await pick.getByRole("button", { name: "Keep & like" }).click();
  await expect(pick).toContainText("AI pick confirmed for your digest");
  expect(feedbackRequests[0]).toMatchObject({
    domain: "esg",
    articleId: 101,
    action: "confirm",
    sharedSelectionId: "00000000-0000-4000-8000-000000000101",
    targetWeekKey: TARGET_WEEK,
  });
});
