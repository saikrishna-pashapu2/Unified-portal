/**
 * Scrapers Index
 * Auto-registers all available scrapers
 */

import { scraperRegistry } from './registry';
import { MitworkKzScraper } from './mitwork-kz';
import { ZakupkiGovRuScraper } from './zakupki-gov-ru';

// Register all scrapers
scraperRegistry.register(new MitworkKzScraper());
scraperRegistry.register(new ZakupkiGovRuScraper());

// Export everything
export * from './base';
export * from './registry';
export * from './mitwork-kz';
export * from './zakupki-gov-ru';

// Export the registry as default
export { scraperRegistry as default };
