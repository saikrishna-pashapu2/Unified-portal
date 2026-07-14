// Standalone workers are server processes. This worker-only path mapping keeps
// Next.js's real `server-only` guard intact for application builds while making
// its marker import a no-op under tsx.
export {};
