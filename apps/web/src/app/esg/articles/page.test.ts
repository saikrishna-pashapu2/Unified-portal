import React, { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), sources: vi.fn(), search: vi.fn(), dailyPickIds: vi.fn(), counts: vi.fn(), liked: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ requireUserSession: mocks.auth }));
vi.mock('@/lib/articles', () => ({ fetchSources: mocks.sources }));
vi.mock('@/lib/esg-article-search/repository', () => ({ searchEsgArticles: mocks.search }));
vi.mock('@/lib/likes', () => ({ getLikeCounts: mocks.counts, getUserLikedSet: mocks.liked }));
vi.mock('@/lib/article-ai/daily-feed', () => ({ getDailyArticlePickIds: mocks.dailyPickIds }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => createElement('a', props, children) }));
vi.mock('@/components/articles/ArticleAiProvider', () => ({ default: ({ children }: { children: ReactNode }) => createElement('div', { 'data-test': 'ai-provider' }, children) }));
vi.mock('@/components/articles/ArticleAiControls', () => ({ default: () => createElement('div', null, 'Existing AI controls') }));
vi.mock('@/components/articles/ArticleAiOnlyFilter', () => ({ default: () => createElement('div', null, 'AI picks filter') }));
vi.mock('@/components/articles/ArticleAiSelection', () => ({ default: () => createElement('div', null, 'Existing AI selection') }));
vi.mock('@/components/articles/ArticlesPaginator', () => ({ default: () => createElement('nav', null, 'Pagination') }));
vi.mock('@/components/articles/EsgArticleSearch', () => ({ default: () => createElement('div', null, 'Search control') }));
vi.mock('@/components/LikeButton', () => ({ default: () => createElement('button', null, 'Like article') }));

import Page from './page';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  mocks.auth.mockResolvedValue({ userId: 17, session: { user: { id: '17' } } });
  mocks.sources.mockResolvedValue(['Archive Journal']);
  mocks.counts.mockResolvedValue({ 101: 2 });
  mocks.liked.mockResolvedValue(new Set([101]));
  mocks.dailyPickIds.mockResolvedValue([101]);
  mocks.search.mockResolvedValue({
    items: [{ id: 101, title: 'Climate archive research', source: 'Archive Journal', published: '2023-01-19', url: 'https://example.test/research', snippet: 'Research across the full archive.', matched_keywords: null }],
    total: 1, page: 1, pageSize: 15, hasMore: false, query: '', typoTolerance: false,
  });
});

describe('ESG article search page', () => {
  it('requires authentication before fetching the archive or sources', async () => {
    mocks.auth.mockResolvedValue({ response: new Response(null, { status: 401 }) });
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/signin');
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.sources).not.toHaveBeenCalled();
  });

  it('browses every date by default and retains existing article actions', async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(mocks.search).toHaveBeenCalledWith({ q: '', source: '', from: '', to: '', sort: 'newest', page: 1 });
    expect(html).toContain('Climate archive research');
    expect(html).toContain('Existing AI controls');
    expect(html).toContain('Existing AI selection');
    expect(html).toContain('Like article');
    expect(mocks.liked).toHaveBeenCalledWith('esg', 17, 'article', [101]);
  });

  it('preserves search filters in the article back link', async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: 'climate', source: 'Archive Journal', from: '2023-01-01', to: '2023-12-31', page: '2' }) }));
    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ q: 'climate', page: 2, from: '2023-01-01', to: '2023-12-31' }));
    expect(html).toContain('back=%2Fesg%2Farticles%3Fq%3Dclimate');
    expect(html).toContain('%26page%3D2');
  });

  it('uses the shared daily pick ids for the server-side AI-only filter', async () => {
    await Page({ searchParams: Promise.resolve({ ai: '1', q: 'climate', page: '2' }) });

    expect(mocks.dailyPickIds).toHaveBeenCalledWith('esg');
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'climate', page: 2 }),
      { articleIds: [101] },
    );
  });

  it('reports a database error without claiming there are no matching articles', async () => {
    mocks.search.mockRejectedValueOnce(new Error('internal password=test-secret'));
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: 'climate' }) }));
    expect(html).toContain('temporarily unavailable');
    expect(html).not.toContain('No articles match');
    expect(html).not.toContain('0 matching article');
    expect(html).not.toContain('test-secret');
  });

  it('invalid filters do not silently run a different search', async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ from: '2023-02-30' }) }));
    expect(mocks.search).not.toHaveBeenCalled();
    expect(html).toContain('Invalid from date');
  });
});
