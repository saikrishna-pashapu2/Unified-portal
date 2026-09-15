/** Render the actual client component against mocked APIs; no auth/database fixture is created. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const testRequire = createRequire(require.resolve('vitest/package.json'));
const { createServer } = await import(pathToFileURL(testRequire.resolve('vite')).href);
const entry = '\0esg-test-entry';
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { host: '127.0.0.1', port: 4177, strictPort: true },
  resolve: { alias: { '@': resolve('src'), 'next/navigation': resolve('scripts/esg-drivers-test-navigation.ts') } },
  esbuild: { jsx: 'automatic' },
  plugins: [{
    name: 'isolated-esg-client',
    resolveId(id: string) {
      if (id === '/esg-test-entry.tsx') return entry;
    },
    load(id: string) {
      if (id === entry) return `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import EsgDriversTool from '/src/app/esg/tools/drivers.tsx';
        import '/src/app/globals.css';
        createRoot(document.getElementById('root')).render(React.createElement(EsgDriversTool));
      `;
    },
    configureServer(instance: { middlewares: { use: (handler: (req: { url?: string }, res: { setHeader: (k: string, v: string) => void; end: (s: string) => void }, next: () => void) => void) => void } }) {
      instance.middlewares.use((req, res, next) => {
        if (req.url === '/' || req.url?.startsWith('/esg/tools')) {
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/esg-test-entry.tsx"></script></body></html>');
        } else next();
      });
    },
  }],
});
await server.listen();
console.log('Isolated ESG driver UI ready on http://127.0.0.1:4177');
