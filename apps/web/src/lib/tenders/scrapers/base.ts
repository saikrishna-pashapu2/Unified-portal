/**
 * Base Scraper Interface
 * All tender source scrapers must implement this interface
 */

export interface TenderListItem {
  lotId: string;
  tenderNumber: string;
  title: string;
  customer: string;
  amount: string;
  deadline: string;
  status: string;
  url: string;
}

export interface TenderDetail {
  lotId: string;
  tenderNumber: string;
  title: string;
  description?: string;
  additionalInfo?: string;
  ktruCode?: string;
  procurementMethod?: string;
  procurementType?: string;
  totalAmount?: string;
  advancePayment?: string;
  applicationDates?: string;
  contractPeriod?: string;
  deliveryTerms?: string;
  customerName?: string;
  customerBin?: string;
  status?: string;
}

export interface ParsedDates {
  published?: Date | null;
  applicationStart?: Date | null;
  applicationEnd?: Date | null;
  contractStart?: Date | null;
  contractEnd?: Date | null;
}

export interface ScraperConfig {
  searchKeywords?: string[];
  maxPages?: number;
  pageSize?: number;
  filters?: Record<string, any>;
  [key: string]: any;
}

/**
 * Base interface that all scrapers must implement
 */
export interface ITenderScraper {
  /**
   * Unique identifier for this scraper
   */
  readonly sourceShortName: string;

  /**
   * Scrape tender list pages and return basic info
   */
  scrapeListPages(
    baseUrl: string,
    config: ScraperConfig
  ): Promise<TenderListItem[]>;

  /**
   * Scrape detailed information from a single tender page
   */
  scrapeTenderDetail(
    url: string,
    baseUrl: string
  ): Promise<TenderDetail | null>;

  /**
   * Parse dates from tender detail data
   */
  parseDates(detail: TenderDetail): ParsedDates;

  /**
   * Validate if a tender should be processed (e.g., check keywords, filters)
   */
  shouldProcess?(detail: TenderDetail, config: ScraperConfig): boolean;
}

/**
 * Abstract base class with common functionality
 */
export abstract class BaseTenderScraper implements ITenderScraper {
  abstract readonly sourceShortName: string;

  abstract scrapeListPages(
    baseUrl: string,
    config: ScraperConfig
  ): Promise<TenderListItem[]>;

  abstract scrapeTenderDetail(
    url: string,
    baseUrl: string
  ): Promise<TenderDetail | null>;

  abstract parseDates(detail: TenderDetail): ParsedDates;

  /**
   * Default implementation - can be overridden
   */
  shouldProcess(detail: TenderDetail, config: ScraperConfig): boolean {
    // Default: process all tenders
    return true;
  }

  /**
   * Helper: Delay between requests
   */
  protected async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Helper: Fetch with retry logic
   */
  protected async fetchWithRetry(
    url: string,
    options: RequestInit = {},
    maxRetries = 3
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
            ...options.headers,
          },
        });

        if (response.ok) {
          return response;
        }

        // Don't retry 4xx errors (except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
      }

      // Wait before retry (exponential backoff)
      if (i < maxRetries - 1) {
        await this.delay(Math.pow(2, i) * 1000);
      }
    }

    throw lastError || new Error('Fetch failed after retries');
  }

  /**
   * Helper: Extract amount as number
   */
  protected extractAmount(amountStr: string): number | null {
    if (!amountStr) return null;

    // Remove currency symbols, spaces, and parse
    const cleaned = amountStr.replace(/[^\d.,]/g, '');
    const normalized = cleaned.replace(/,/g, '');
    const amount = parseFloat(normalized);

    return isNaN(amount) ? null : amount;
  }

  /**
   * Helper: Extract currency from amount string
   */
  protected extractCurrency(amountStr: string): string {
    if (!amountStr) return 'USD';

    const currencyMap: Record<string, string> = {
      '₸': 'KZT',
      '₽': 'RUB',
      '€': 'EUR',
      '£': 'GBP',
      '$': 'USD',
      тг: 'KZT',
      руб: 'RUB',
    };

    for (const [symbol, code] of Object.entries(currencyMap)) {
      if (amountStr.includes(symbol)) {
        return code;
      }
    }

    return 'USD';
  }
}
