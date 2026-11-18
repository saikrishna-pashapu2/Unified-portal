/** Neutral product copy for service messages, including messages saved by older jobs.
 * Apply only to application messages, never to uploaded or translated document text.
 * Keep the original diagnostics in storage and server logs for troubleshooting.
 */
export function translatorDisplayMessage(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\bOPENAI_API_KEY\b/gi, 'Translation service configuration')
    .replace(/\bOpenAI\b/gi, 'Translation service');
}
