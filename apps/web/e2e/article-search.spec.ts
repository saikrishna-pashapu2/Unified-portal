import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const endpoint = '**/api/esg/articles/search?**';
const item = (id: number, title: string) => ({
  id, title, source: 'Climate Journal', published: '2023-01-19', url: null,
  snippet: 'Research on climate disclosure and sustainable investment.', matched_keywords: 'ESG',
});
const response = (query: string, items = [item(101, 'Climate disclosure in emerging markets'), item(102, 'Climate policy and investment')]) => ({
  items, total: null, page: 1, pageSize: 6, hasMore: false, query, typoTolerance: true,
});
const searchInput = (page: Page) => page.getByRole('combobox', { name: 'Search the ESG archive' });
const suggestions = (page: Page) => page.locator('[role="option"]');

test('debounces typing, waits for two characters, and exposes accessible matching articles', async ({ page }, testInfo) => {
  const queries: string[] = [];
  await page.route(endpoint, async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q')!;
    queries.push(query);
    await route.fulfill({ json: response(query) });
  });
  await page.goto('/esg/articles');
  await searchInput(page).fill('c');
  await page.waitForTimeout(350); // Verify the actual debounce/minimum-query boundary.
  expect(queries).toEqual([]);
  await searchInput(page).pressSequentially('limate', { delay: 20 });
  await expect(suggestions(page)).toHaveCount(2);
  expect(queries).toEqual(['climate']);
  await expect(suggestions(page).first().locator('mark').first()).toContainText('Climate');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('desktop-search.png'), fullPage: true });
});

test('keyboard suggestion navigation and Back retain the query and filters', async ({ page }) => {
  await page.route(endpoint, (route) => route.fulfill({ json: response('climate') }));
  await page.goto('/esg/articles?source=Climate+Journal&from=2023-01-01&to=2023-12-31&page=5');
  await searchInput(page).fill('climate');
  await expect(suggestions(page)).toHaveCount(2);
  await searchInput(page).press('ArrowDown');
  await expect(suggestions(page).first()).toHaveAttribute('aria-selected', 'true');
  await searchInput(page).press('ArrowDown');
  await searchInput(page).press('Enter');
  await expect(page).toHaveURL(/\/esg\/articles\/102\?/);
  const back = new URL(new URL(page.url()).searchParams.get('back')!, 'http://local.test');
  expect(back.searchParams.get('q')).toBe('climate');
  expect(back.searchParams.get('source')).toBe('Climate Journal');
  expect(back.searchParams.get('from')).toBe('2023-01-01');
  expect(back.searchParams.get('to')).toBe('2023-12-31');
  await page.getByRole('button', { name: 'Back to results' }).click();
  await expect(searchInput(page)).toHaveValue('climate');
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('Enter searches the whole archive by relevance and resets pagination', async ({ page }) => {
  await page.route(endpoint, (route) => route.fulfill({ json: response('climate') }));
  await page.goto('/esg/articles?page=9');
  await searchInput(page).fill('climate');
  await searchInput(page).press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('climate');
  const params = new URL(page.url()).searchParams;
  expect(params.get('sort')).toBe('relevance');
  expect(params.get('page')).toBe('1');
  expect(params.has('from')).toBe(false);
  expect(params.has('to')).toBe(false);
  await page.getByRole('button', { name: 'Clear article search' }).click();
  await expect(searchInput(page)).toHaveValue('');
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
});

test('late responses cannot reopen dismissed suggestions or replace a newer query', async ({ page }) => {
  let finishOld!: () => void;
  let oldStarted!: () => void;
  const started = new Promise<void>((resolve) => { oldStarted = resolve; });
  const release = new Promise<void>((resolve) => { finishOld = resolve; });
  await page.route(endpoint, async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q')!;
    if (q === 'climate') { oldStarted(); await release; }
    await route.fulfill({ json: response(q, [item(q === 'climate' ? 101 : 202, q === 'climate' ? 'Old climate result' : 'Fresh governance result')]) });
  });
  await page.goto('/esg/articles');
  await searchInput(page).fill('climate');
  await started;
  await searchInput(page).fill('governance');
  await expect(suggestions(page)).toContainText(['Fresh governance result']);
  finishOld();
  await page.waitForTimeout(100);
  await expect(suggestions(page)).toContainText(['Fresh governance result']);
  await searchInput(page).press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await searchInput(page).fill('climate risk');
  await page.getByRole('button', { name: 'Outside search' }).click();
  await page.waitForTimeout(400);
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('API failure is not reported as an empty archive and Retry recovers', async ({ page }) => {
  let requests = 0;
  await page.route(endpoint, (route) => {
    requests++;
    return requests === 1
      ? route.fulfill({ status: 503, json: { error: 'Search is temporarily unavailable.' } })
      : route.fulfill({ json: response('climate') });
  });
  await page.goto('/esg/articles');
  await searchInput(page).fill('climate');
  await expect(page.getByRole('alert')).toContainText('Search is temporarily unavailable.');
  await expect(page.getByText(/No matching articles/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(suggestions(page)).toHaveCount(2);
});

test('View all results works by pointer and preserves source and dates', async ({ page }) => {
  const requests: URL[] = [];
  await page.route(endpoint, (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ json: response('climate') });
  });
  await page.goto('/esg/articles?source=Climate+Journal&from=2023-01-01&to=2023-12-31');
  await searchInput(page).fill('climate');
  await expect(suggestions(page)).toHaveCount(2);
  expect(requests[0].searchParams.get('source')).toBe('Climate Journal');
  expect(requests[0].searchParams.get('from')).toBe('2023-01-01');
  await page.getByRole('button', { name: 'View all results' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('climate');
  expect(new URL(page.url()).searchParams.get('to')).toBe('2023-12-31');
});

test('IME composition does not navigate or send partial requests', async ({ page }) => {
  let requests = 0;
  await page.route(endpoint, (route) => {
    requests++;
    return route.fulfill({ json: response('气候') });
  });
  await page.goto('/esg/articles');
  await searchInput(page).focus();
  await searchInput(page).dispatchEvent('compositionstart');
  await searchInput(page).fill('气候');
  await searchInput(page).press('Enter');
  await page.waitForTimeout(350);
  expect(requests).toBe(0);
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  await searchInput(page).dispatchEvent('compositionend', { data: '气候' });
  await expect(suggestions(page)).toHaveCount(2);
  expect(requests).toBe(1);
});

test('mobile suggestions fit the viewport and treat article markup as text', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(endpoint, (route) => route.fulfill({ json: response('climate', [item(101, '<img src=x onerror=alert(1)> Climate policy')]) }));
  await page.goto('/esg/articles');
  await searchInput(page).fill('climate');
  await expect(suggestions(page)).toHaveCount(1);
  await expect(suggestions(page)).toContainText('<img src=x onerror=alert(1)>');
  await expect(suggestions(page).locator('img')).toHaveCount(0);
  const geometry = await page.getByRole('listbox').boundingBox();
  const inputGeometry = await searchInput(page).boundingBox();
  expect(geometry!.x).toBeGreaterThanOrEqual(0);
  expect(geometry!.x + geometry!.width).toBeLessThanOrEqual(390);
  expect(geometry!.y - (inputGeometry!.y + inputGeometry!.height)).toBeLessThanOrEqual(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('mobile-search.png'), fullPage: true });
});
