/** @type {import('next').NextConfig} */
const path = require('node:path');

const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  outputFileTracingIncludes: {
    '/*': ['./node_modules/pdfjs-dist/standard_fonts/**/*'],
  },
  transpilePackages: ['@esgcredit/db-esg', '@esgcredit/db-credit'],
  serverExternalPackages: [
    '@prisma/client',
    'prisma',
    'pdfjs-dist',
    '@napi-rs/canvas',
    // lib/workbook.ts passes `require.resolve('xlsx')` into a worker thread.
    // When xlsx is bundled, webpack rewrites that to a numeric module id, and
    // the worker (a plain Node context) then does require(78365) and throws
    // `The "id" argument must be of type string. Received type number`.
    // Keeping xlsx external makes require.resolve return a real file path.
    'xlsx',
    '@langchain/core',
    '@langchain/openai',
    'langchain',
    '@langchain/langgraph',
    'node-cron'
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // When server bundles anything that tries to require('canvas'),
      // give it an empty module so it never loads native bindings.
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        canvas: false,
      };
    }
    return config;
  },
}

module.exports = nextConfig
