/**
 * Scraper Registry
 * Central registry for all tender scrapers
 */

import { ITenderScraper } from './base';

class ScraperRegistry {
  private scrapers: Map<string, ITenderScraper> = new Map();

  /**
   * Register a new scraper
   */
  register(scraper: ITenderScraper): void {
    if (this.scrapers.has(scraper.sourceShortName)) {
      console.warn(
        `[Scraper Registry] Overwriting existing scraper: ${scraper.sourceShortName}`
      );
    }
    this.scrapers.set(scraper.sourceShortName, scraper);
    console.log(`[Scraper Registry] Registered: ${scraper.sourceShortName}`);
  }

  /**
   * Get a scraper by source short name
   */
  get(sourceShortName: string): ITenderScraper | undefined {
    return this.scrapers.get(sourceShortName);
  }

  /**
   * Check if a scraper is registered
   */
  has(sourceShortName: string): boolean {
    return this.scrapers.has(sourceShortName);
  }

  /**
   * Get all registered scrapers
   */
  getAll(): ITenderScraper[] {
    return Array.from(this.scrapers.values());
  }

  /**
   * Get all source short names
   */
  getSources(): string[] {
    return Array.from(this.scrapers.keys());
  }

  /**
   * Unregister a scraper
   */
  unregister(sourceShortName: string): boolean {
    return this.scrapers.delete(sourceShortName);
  }

  /**
   * Clear all scrapers
   */
  clear(): void {
    this.scrapers.clear();
  }
}

// Singleton instance
export const scraperRegistry = new ScraperRegistry();

/**
 * Helper function to get a scraper
 */
export function getScraper(sourceShortName: string): ITenderScraper {
  const scraper = scraperRegistry.get(sourceShortName);
  
  if (!scraper) {
    throw new Error(
      `No scraper registered for source: ${sourceShortName}. ` +
      `Available sources: ${scraperRegistry.getSources().join(', ')}`
    );
  }
  
  return scraper;
}
