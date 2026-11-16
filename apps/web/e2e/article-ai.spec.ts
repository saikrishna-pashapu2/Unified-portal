import { expect, test, type Page } from "@playwright/test";

type Domain = "esg" | "credit";
type SelectionState = "selected" | "confirmed" | "dismissed";

const selectionFor = (domain: Domain, articleId: number, overrides: Record<string, unknown> = {}) => ({
  articleId,
  domain,
  state: "selected" as SelectionState,
  reason: domain === "esg" ? "Matches your climate disclosure history." : "Matches your sovereign rating history.",
  version: 1,
  selectedAt: "2026-11-16T08:00:00.000Z",
  expiresAt: "2026-11-23T08:00:00.000Z",
  pendingConfirmation: false,
  ...overrides,
});

function preference(domain: Domain, overrides: Record<string, unknown> = {}) {
  return {
    domain,
    enabled: true,
    settingsVersion: 1,
    historyCount: domain === "esg" ? 20 : 8,
    profileSource: domain === "esg" ? "personal" : "team",
    weeklyDigestConfigured: domain === "credit",
    status: "ready",
    lastRunAt: "2026-11-16T08:00:00.000Z",
    emailInclusionEnabled: domain === "esg",
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
  } = {},
) {
  const prefs: Record<Domain, any> = {
    esg: preference("esg"),
    credit: preference("credit", { weeklyDigestConfigured: true, emailInclusionEnabled: false }),
  };
  const selections: Record<Domain, any[]> = {
    esg: options.includePendingEsg
      ? [selectionFor("esg", 101), selectionFor("esg", 102, { pendingConfirmation: true })]
      : [selectionFor("esg", 101)],
    credit: options.resolveCreditPending
      ? [selectionFor("credit", 201), selectionFor("credit", 202, { pendingConfirmation: true })]
      : [selectionFor("credit", 201)],
  };
  const selectionCalls: Record<Domain, number> = { esg: 0, credit: 0 };
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
        status: body.enabled ? "queued" : "off",
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
    };
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
    const current = selections[body.domain].find((selection) => selection.articleId === body.articleId);
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

  return { selectionCalls };
}

test("keeps ESG and Credit switches independent, batches selections, and preserves filters", async ({ page }) => {
  const { selectionCalls } = await mockArticleAiApis(page);
  await page.goto("/articles?source=Regulator&date=2026-11-16");

  await expect(page.getByTestId("article-ai-controls-esg")).toBeVisible();
  await expect(page.getByTestId("article-ai-controls-credit").first()).toBeVisible();
  await expect(page.getByText("To receive private AI picks, configure a weekly article email for this domain to your account email in")).toBeVisible();
  await expect(page.getByText("AI selection is in preview mode here.")).toBeVisible();
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
  await expect(creditPick).toContainText("human signal");
});

test("recovers from selection loading errors and shows signed-out guidance", async ({ page }) => {
  await mockArticleAiApis(page, { selectionFailureOnce: true });
  await page.goto("/articles");

  await expect(page.getByText("Selection service unavailable.")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).first().click();
  await expect(page.getByTestId("article-ai-selection-101")).toBeVisible();
  await expect(page.getByText("Sign in to create a private ESG/Credit profile for your weekly email digest.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to personalize" })).toHaveAttribute("href", "/signin");
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
