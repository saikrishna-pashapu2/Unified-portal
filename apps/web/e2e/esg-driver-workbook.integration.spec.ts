import { expect, test } from '@playwright/test';
import * as XLSX from 'xlsx';

function hasDisposableDatabase(): boolean {
  try {
    const url = new URL(process.env.ESG_DATABASE_URL || '');
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && (
      url.pathname === '/esg_catalog_test' ||
      (process.env.CI === 'true' && url.pathname === '/portal_esg')
    );
  } catch { return false; }
}

// Run through the real route and its worker in the built app. Mocked API and
// source-only parser tests cannot detect webpack rewriting module resolution.
test('a regular signed-in user uploads and activates a workbook through the built application', async ({ page, baseURL }) => {
  test.skip(!hasDisposableDatabase(), 'Requires the disposable catalog database or CI database.');
  const origin = new URL(baseURL!).origin;
  const csrf = await (await page.request.get('/api/auth/csrf')).json();
  await page.request.post('/api/auth/callback/credentials', { form: {
    email: process.env.E2E_EMAIL ?? 'e2e-user@example.test',
    password: process.env.E2E_PASSWORD ?? 'E2e-Smoke-Password!42',
    csrfToken: csrf.csrfToken, json: 'true', callbackUrl: `${origin}/esg`,
  } });
  const catalogPath = '/api/esg/drivers/workbooks';
  const originalResponse = await page.request.get(catalogPath);
  expect(originalResponse.ok()).toBeTruthy();
  const original = await originalResponse.json();
  let uploadedId: string | undefined;

  try {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['Driver Section/Country', 'Driver Type', 'Driver Name', 'Driver Logic', 'Evidence/KPI', 'Key Sources', 'Link'],
      ['Global Drivers', 'Framework', 'Exact global driver', 'Global scope', '', 'Example', 'https://example.org/global?year=2026'],
      ['Germany', 'Regulation', 'Exact country driver', `Scope ${Date.now()}`, '', 'Example', 'https://example.org/local#clause'],
    ]), 'Aviation');
    const upload = await page.request.post(catalogPath, {
      headers: { origin },
      multipart: { file: {
        name: 'Updated drivers.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
      } },
    });
    expect(upload.status(), await upload.text()).toBe(200);
    const preview = await upload.json();
    uploadedId = preview.version.id;
    expect(preview.version.isActive).toBe(false);
    expect(preview.active.id).toBe(original.active.id);

    const activeResponse = await page.request.post(`${catalogPath}/${uploadedId}/activate`, {
      headers: { origin }, data: { expectedRevision: preview.revision },
    });
    expect(activeResponse.status(), await activeResponse.text()).toBe(200);
    const active = await activeResponse.json();
    expect(active.active.id).toBe(uploadedId);
    expect(active.options).toMatchObject({ countries: ['Germany'], sectors: ['Aviation'], counts: { Aviation: { Germany: 2 } } });

    const staleResponse = await page.request.post(`${catalogPath}/${original.active.id}/activate`, {
      headers: { origin }, data: { expectedRevision: preview.revision },
    });
    expect(staleResponse.status()).toBe(409);
  } finally {
    const latest = await (await page.request.get(catalogPath)).json();
    if (uploadedId && latest.active?.id === uploadedId) {
      const rollback = await page.request.post(`${catalogPath}/${original.active.id}/activate`, {
        headers: { origin }, data: { expectedRevision: latest.revision },
      });
      expect(rollback.status(), await rollback.text()).toBe(200);
    }
  }
});
