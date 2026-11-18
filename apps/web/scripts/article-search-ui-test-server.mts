/** Isolated production search component. No Next auth, database writes, or model calls. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const testRequire = createRequire(require.resolve('vitest/package.json'));
const { createServer } = await import(pathToFileURL(testRequire.resolve('vite')).href);
const entry = '/article-search-test-entry.tsx';

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { host: '127.0.0.1', port: 4183, strictPort: true },
  resolve: { alias: {
    '@': resolve('src'),
    'next/navigation': resolve('scripts/article-search-test-navigation.tsx'),
    'next/link': resolve('scripts/article-search-test-navigation.tsx'),
  } },
  esbuild: { jsx: 'automatic' },
  plugins: [{
    name: 'isolated-article-search',
    resolveId(id: string) { if (id === '/article-search-test-entry.tsx') return entry; },
    load(id: string) {
      if (id !== entry) return;
      return `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import EsgArticleSearch from '/src/components/articles/EsgArticleSearch.tsx';
        import CreditArticleSearch from '/src/components/articles/CreditArticleSearch.tsx';
        import {parseCreditArticleSearchParams} from '/src/lib/credit-article-search/query.ts';
        import {parseArticleSearchParams} from '/src/lib/esg-article-search/query.ts';
        import {useSearchParams, usePathname, useRouter} from '/scripts/article-search-test-navigation.tsx';
        import '/src/app/globals.css';
        function Harness() {
          const params=useSearchParams();
          const path=usePathname();
          const router=useRouter();
          const credit=path.startsWith('/credit/');
          const parse=credit ? parseCreditArticleSearchParams : parseArticleSearchParams;
          const result=parse(params);
          const fallback=parse(new URLSearchParams());
          const filters=result.ok ? result.filters : fallback.filters;
          if (/\\/articles\\/\\d+$/.test(path)) return <main className="p-8"><h1>Article detail</h1><button onClick={()=>router.push(params.get('back') || '/esg/articles')}>Back to results</button></main>;
          return <main className="min-h-screen bg-slate-50 px-4 py-10"><div className="mx-auto max-w-6xl">
            <h1 className="mb-2 text-3xl font-semibold text-slate-950">ESG News & Insights</h1>
            <p className="mb-8 text-slate-600">Search the complete article archive.</p>
            {credit ? <CreditArticleSearch filters={filters} sources={['Fitch','Moody’s']} /> : <EsgArticleSearch filters={filters} sources={['Climate Journal','Policy Review']} />}
            <output data-testid="navigation-state" className="mt-6 block break-all text-sm">{path + '?' + params.toString()}</output>
            <button type="button" className="mt-6 rounded border px-4 py-2">Outside search</button>
          </div></main>;
        }
        createRoot(document.getElementById('root')).render(<Harness />);
      `;
    },
    configureServer(instance: { middlewares: { use: (handler: (req: {url?: string}, res: {setHeader:(key:string,value:string)=>void;end:(body:string)=>void}, next:()=>void)=>void)=>void } }) {
      instance.middlewares.use((req, res, next) => {
        if (req.url === '/' || req.url?.startsWith('/esg/articles') || req.url?.startsWith('/credit/articles')) {
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ESG search local test</title></head><body><div id="root"></div><script type="module" src="/article-search-test-entry.tsx"></script></body></html>');
          return;
        }
        next();
      });
    },
  }],
});
await server.listen();
console.log('Isolated ESG article search ready on http://127.0.0.1:4183');
