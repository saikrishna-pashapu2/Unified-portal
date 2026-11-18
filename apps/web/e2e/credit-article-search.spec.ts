import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('Credit typeahead keeps rating signs, section and source, opens a Credit article and returns to results', async ({ page }) => {
  const calls: URL[] = [];
  const foreignCalls: string[] = [];
  page.on('request', req => { if(req.url().includes('/api/esg/')) foreignCalls.push(req.url()); });
  await page.route('**/api/credit/articles/search?**', async route => {
    const url = new URL(route.request().url());
    calls.push(url);
    await route.fulfill({json: {
      items:[{id:205, title:'Issuer raised to AA+', snippet:'Stable outlook', source:'Fitch', published:'2020-08-14',
        matched_keywords:'banks', url:null, region:'CentralAsia', sector:'banksRACS'}],
      total:null, page:1, pageSize:6, hasMore:false, typoTolerance:false, query:url.searchParams.get('q'),
    }});
  });
  await page.goto('/credit/articles?region=CentralAsia&sector=banksRACS&source=Fitch&dateFrom=2020-08-14&page=3');
  const input = page.getByRole('combobox', {name:/Search the Credit Rating archive/i});
  await input.fill('A');
  await page.waitForTimeout(350);
  expect(calls).toHaveLength(0);
  await input.fill('AA+');
  const option = page.getByRole('option', {name:/Issuer raised/});
  await expect(option).toBeVisible();
  expect(calls).toHaveLength(1);
  const params = calls[0].searchParams;
  for (const [key,value] of Object.entries({q:'AA+',suggest:'1',region:'CentralAsia',sector:'banksRACS',source:'Fitch',from:'2020-08-14',to:'2020-08-14'})) {
    expect(params.get(key)).toBe(value);
  }
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/credit\/articles\/205\?/);
  const back = new URL(new URL(page.url()).searchParams.get('back')!, page.url());
  expect(back.pathname).toBe('/credit/articles');
  expect(back.searchParams.get('q')).toBe('AA+');
  expect(back.searchParams.get('sector')).toBe('banksRACS');
  expect(back.searchParams.get('page')).toBe('1');
  await page.getByRole('button',{name:'Back to results'}).click();
  await expect(input).toHaveValue('AA+');
  expect(foreignCalls).toEqual([]);
});

test('Credit mobile search distinguishes an unavailable service from no matches and submits the whole archive', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  let attempts=0;
  await page.route('**/api/credit/articles/search?**', route => ++attempts===1
    ? route.fulfill({status:503,json:{error:'Temporarily unavailable'}})
    : route.fulfill({json:{items:[],page:1,pageSize:6,total:null,hasMore:false,typoTolerance:false,query:'sovereign'}}));
  await page.goto('/credit/articles');
  const input=page.getByRole('combobox', {name:/Search the Credit Rating archive/i});
  await input.fill('sovereign');
  await expect(page.getByRole('alert')).toContainText('Temporarily unavailable');
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByText(/No matching articles/)).toBeVisible();
  await input.press('Enter');
  await expect.poll(()=>new URL(page.url()).searchParams.get('q')).toBe('sovereign');
  const params=new URL(page.url()).searchParams;
  expect(params.get('sort')).toBe('relevance');
  expect(params.has('from')).toBe(false);
  expect(params.has('region')).toBe(false);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
});
