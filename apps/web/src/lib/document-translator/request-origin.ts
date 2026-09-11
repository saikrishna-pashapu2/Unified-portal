/** Use the configured public origin behind the production reverse proxy.
 * Host/forwarded headers are not a trusted origin allowlist.
 */
export function isTranslatorRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    const expected = process.env.NODE_ENV === "production"
      ? new URL(process.env.NEXTAUTH_URL || "")
      : new URL(request.url);
    if (!["http:", "https:"].includes(expected.protocol) ||
        expected.username || expected.password) return false;
    return origin === expected.origin;
  } catch {
    return false;
  }
}
