/** Render the production Article AI controls against Playwright-mocked APIs. */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const testRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(testRequire.resolve("vite")).href);
const entry = "\0article-ai-test-entry";

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { host: "127.0.0.1", port: 4182, strictPort: true },
  resolve: {
    alias: {
      "@": resolve("src"),
      "next/navigation": resolve("scripts/article-ai-test-navigation.ts"),
    },
  },
  esbuild: { jsx: "automatic" },
  plugins: [
    {
      name: "isolated-article-ai-client",
      resolveId(id: string) {
        if (id === "/article-ai-test-entry.tsx") return entry;
      },
      load(id: string) {
        if (id !== entry) return;
        return `
          import React, { useEffect, useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import ArticleAiProvider from '/src/components/articles/ArticleAiProvider.tsx';
          import ArticleAiControls from '/src/components/articles/ArticleAiControls.tsx';
          import ArticleAiSelection from '/src/components/articles/ArticleAiSelection.tsx';
          import '/src/app/globals.css';

          const ids = {
            esg: [101, 102],
            credit: [201, 202],
          };

          function LikeCount({ articleId }) {
            const [refreshes, setRefreshes] = useState(0);
            useEffect(() => {
              const onRefresh = () => setRefreshes((current) => current + 1);
              window.addEventListener('article-ai-router-refresh', onRefresh);
              return () => window.removeEventListener('article-ai-router-refresh', onRefresh);
            }, []);
            return React.createElement(
              'output',
              { 'data-testid': 'server-like-count-' + articleId, 'aria-label': 'Server like count' },
              refreshes,
            );
          }

          function DomainPanel({ domain, authenticated = true }) {
            return React.createElement(
              ArticleAiProvider,
              { domain, articleIds: [...ids[domain]], isAuthenticated: authenticated },
              React.createElement(
                'section',
                { 'data-testid': 'domain-panel-' + domain + '-' + (authenticated ? 'signed-in' : 'signed-out') },
                React.createElement(ArticleAiControls, { domain }),
                React.createElement(
                  'div',
                  { className: 'mt-3 space-y-2' },
                  ...ids[domain].flatMap((articleId) => [
                    React.createElement(ArticleAiSelection, { key: 'selection-' + articleId, articleId }),
                    React.createElement(LikeCount, { key: 'count-' + articleId, articleId }),
                  ]),
                ),
              ),
            );
          }

          function FocusSwitcher() {
            const [domain, setDomain] = useState('esg');
            return React.createElement(
              'section',
              { 'data-testid': 'focus-switcher' },
              React.createElement(
                'button',
                { type: 'button', onClick: () => setDomain(domain === 'esg' ? 'credit' : 'esg'), className: 'mb-4 rounded-lg border px-3 py-2 text-sm' },
                domain === 'esg' ? 'Navigate to Credit' : 'Navigate to ESG',
              ),
              React.createElement(DomainPanel, { domain }),
            );
          }

          function Harness() {
            const focusOnly = new URLSearchParams(location.search).get('focus') === '1';
            return React.createElement(
              'main',
              { className: 'mx-auto max-w-4xl space-y-6 p-6' },
              React.createElement('h1', { className: 'text-2xl font-bold' }, 'Article AI test surface'),
              React.createElement(
                'form',
                { method: 'get', action: '/articles', className: 'rounded-xl border p-4', 'aria-label': 'Article filters' },
                React.createElement('label', { className: 'flex flex-col gap-1 text-sm' }, 'Source', React.createElement('input', { name: 'source', defaultValue: new URLSearchParams(location.search).get('source') ?? '' })),
                React.createElement('label', { className: 'mt-3 flex flex-col gap-1 text-sm' }, 'Date', React.createElement('input', { type: 'date', name: 'date', defaultValue: new URLSearchParams(location.search).get('date') ?? '' })),
                React.createElement('button', { type: 'submit', className: 'mt-3 rounded-lg border px-3 py-2 text-sm' }, 'Apply filters'),
              ),
              focusOnly
                ? React.createElement(FocusSwitcher)
                : React.createElement(React.Fragment, null,
                    React.createElement(DomainPanel, { domain: 'esg' }),
                    React.createElement(DomainPanel, { domain: 'credit' }),
                    React.createElement(DomainPanel, { domain: 'credit', authenticated: false }),
                  ),
            );
          }

          createRoot(document.getElementById('root')).render(React.createElement(Harness));
        `;
      },
      configureServer(instance: {
        middlewares: {
          use: (
            handler: (
              req: { url?: string },
              res: { setHeader: (key: string, value: string) => void; end: (body: string) => void },
              next: () => void,
            ) => void,
          ) => void;
        };
      }) {
        instance.middlewares.use((req, res, next) => {
          if (req.url === "/" || req.url?.startsWith("/articles")) {
            res.setHeader("Content-Type", "text/html");
            res.end(
              '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/article-ai-test-entry.tsx"></script></body></html>',
            );
            return;
          }
          next();
        });
      },
    },
  ],
});

await server.listen();
console.log("Isolated Article AI UI ready on http://127.0.0.1:4182");
