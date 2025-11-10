/**
 * Tender Scraper Engine
 * Universal scraper that works with any registered scraper
 */

import { esgPrisma as db } from '@esgcredit/db-esg';
import { translateTender } from './translator-simple';
import { getScraper } from './scrapers/registry';
import type { TenderListItem, TenderDetail } from './scrapers/base';

interface ScrapeResult {
  success: boolean;
  tendersFound: number;
  tendersNew: number;
  tendersUpdated: number;
  tendersFailed: number;
  errors: string[];
}

/**
 * Main scraper function - works with any registered scraper
 */
export async function scrapeTenders(
  sourceShortName: string = 'mitwork_kz'
): Promise<ScrapeResult> {
  const startTime = Date.now();

  console.log(`[Tender Scraper Engine] Starting scrape for: ${sourceShortName}`);

  const result: ScrapeResult = {
    success: false,
    tendersFound: 0,
    tendersNew: 0,
    tendersUpdated: 0,
    tendersFailed: 0,
    errors: [],
  };

  try {
    // Get source configuration from database
    const source = await db.tender_sources.findUnique({
      where: { short_name: sourceShortName },
    });

    if (!source) {
      throw new Error(`Source not found: ${sourceShortName}`);
    }

    if (!source.is_active) {
      throw new Error(`Source is inactive: ${sourceShortName}`);
    }

    // Get the appropriate scraper from registry
    const scraper = getScraper(sourceShortName);

    // Create scrape log
    const scrapeLog = await db.tender_scrape_logs.create({
      data: {
        source_id: source.id,
        started_at: new Date(),
        status: 'running',
        trigger_type: 'manual',
        scraper_version: '2.0.0', // New version with registry pattern
      },
    });

    console.log(`[Tender Scraper Engine] Scrape log created: ${scrapeLog.id}`);

    // Parse scraper config
    const config = (source.scraper_config as any) || {};
    const baseUrl = source.base_url;

    // Step 1: Scrape list pages using the specific scraper
    console.log(`[Tender Scraper Engine] Using scraper: ${scraper.sourceShortName}`);
    const tenderList = await scraper.scrapeListPages(baseUrl, config);
    result.tendersFound = tenderList.length;

    console.log(
      `[Tender Scraper Engine] Found ${tenderList.length} tenders on list pages`
    );

    // Step 2: Process each tender
    for (const listItem of tenderList) {
      try {
        await processTender(listItem, source.id, baseUrl, config, scraper);
        result.tendersNew++;
      } catch (error) {
        console.error(
          `[Tender Scraper Engine] Failed to process tender ${listItem.lotId}:`,
          error
        );
        result.tendersFailed++;
        result.errors.push(
          `Tender ${listItem.lotId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    // Update scrape log
    const duration = Math.floor((Date.now() - startTime) / 1000);
    await db.tender_scrape_logs.update({
      where: { id: scrapeLog.id },
      data: {
        completed_at: new Date(),
        status: result.tendersFailed > 0 ? 'partial' : 'success',
        tenders_found: result.tendersFound,
        tenders_new: result.tendersNew,
        tenders_updated: result.tendersUpdated,
        tenders_failed: result.tendersFailed,
        duration_seconds: duration,
        error_message:
          result.errors.length > 0 ? result.errors.join('\n') : null,
      },
    });

    // Update source statistics
    await db.tender_sources.update({
      where: { id: source.id },
      data: {
        last_scrape_date: new Date(),
        last_scrape_status: result.tendersFailed > 0 ? 'partial' : 'success',
        total_scrapes: { increment: 1 },
        successful_scrapes:
          result.tendersFailed === 0 ? { increment: 1 } : undefined,
        failed_scrapes: result.tendersFailed > 0 ? { increment: 1 } : undefined,
      },
    });

    result.success = true;
    console.log(`[Tender Scraper Engine] Completed in ${duration}s:`, result);
  } catch (error) {
    console.error('[Tender Scraper Engine] Fatal error:', error);
    result.errors.push(
      error instanceof Error ? error.message : 'Unknown error'
    );
  }

  return result;
}

/**
 * Process individual tender (fetch details, translate, save)
 */
async function processTender(
  listItem: TenderListItem,
  sourceId: number,
  baseUrl: string,
  config: any,
  scraper: any
): Promise<void> {
  console.log(`[Tender Scraper Engine] Processing tender: ${listItem.lotId}`);

  // Check if tender already exists
  const existing = await db.tenders.findFirst({
    where: {
      source_id: sourceId,
      lot_id: listItem.lotId,
    },
  });

  if (existing) {
    console.log(
      `[Tender Scraper Engine] Tender ${listItem.lotId} already exists, skipping`
    );
    return;
  }

  // Fetch full detail using the specific scraper
  const detail = await scraper.scrapeTenderDetail(listItem.url, baseUrl);

  if (!detail) {
    throw new Error('Failed to fetch tender detail');
  }

  // Check if should process this tender
  if (scraper.shouldProcess && !scraper.shouldProcess(detail, config)) {
    console.log(
      `[Tender Scraper Engine] Tender ${listItem.lotId} filtered out by shouldProcess check`
    );
    return;
  }

  // Parse dates using the specific scraper
  const dates = scraper.parseDates(detail);

  // Extract amount and currency
  const totalAmountStr = detail.totalAmount || listItem.amount || '';
  const amount = extractAmount(totalAmountStr);
  const currency = extractCurrency(totalAmountStr);

  // Translate tender using AI
  console.log(
    `[Tender Scraper Engine] Translating tender: ${listItem.lotId}`
  );
  const translation = await translateTender({
    title: detail.title,
    description: detail.description || '',
    additionalInfo: detail.additionalInfo || '',
    customerName: detail.customerName || listItem.customer,
    procurementMethod: detail.procurementMethod || '',
    procurementType: detail.procurementType || '',
    deliveryTerms: detail.deliveryTerms || '',
    status: detail.status || listItem.status,
  });

  // Save to database
  await db.tenders.create({
    data: {
      source_id: sourceId,
      lot_id: detail.lotId || listItem.lotId,
      tender_number: detail.tenderNumber || listItem.tenderNumber,
      tender_url: listItem.url,

      // Original data (in Russian/Kazakh)
      original_title: detail.title,
      original_description: detail.description,
      original_additional_info: detail.additionalInfo,
      original_delivery_terms: detail.deliveryTerms,
      original_status: detail.status || listItem.status,
      original_language: 'ru',

      // Translated data (English)
      title: translation.title,
      description: translation.description,
      additional_info: translation.additionalInfo,
      customer_name: translation.customerName,
      delivery_terms: translation.deliveryTerms,
      status: translation.status,

      // Financial info
      total_amount: amount,
      currency: currency,
      advance_payment: detail.advancePayment,

      // Procurement details
      procurement_method: translation.procurementMethod,
      procurement_type: translation.procurementType,

      // Dates
      published_date: dates.published || dates.applicationStart || null,
      application_start_date: dates.applicationStart || null,
      application_end_date: dates.applicationEnd || null,
      contract_start_date: dates.contractStart || null,
      contract_end_date: dates.contractEnd || null,

      // Technical fields
      ktru_code: detail.ktruCode,
      customer_bin: detail.customerBin,

      // Domain - directly assign to ESG
      primary_domain: 'esg',

      // Metadata
      is_active: true,
    },
  });

  console.log(`[Tender Scraper Engine] Saved tender: ${listItem.lotId}`);
}

/**
 * Helper: Extract amount as number
 */
function extractAmount(amountStr: string): number | null {
  if (!amountStr) return null;

  const cleaned = amountStr.replace(/[^\d.,]/g, '');
  const normalized = cleaned.replace(/,/g, '');
  const amount = parseFloat(normalized);

  return isNaN(amount) ? null : amount;
}

/**
 * Helper: Extract currency from amount string
 */
function extractCurrency(amountStr: string): string {
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

/**
 * Scrape all active sources
 */
export async function scrapeAllActiveSources(): Promise<ScrapeResult[]> {
  console.log('[Tender Scraper Engine] Scraping all active sources');

  const activeSources = await db.tender_sources.findMany({
    where: { is_active: true },
    select: { short_name: true },
  });

  const results: ScrapeResult[] = [];

  for (const source of activeSources) {
    try {
      const result = await scrapeTenders(source.short_name);
      results.push(result);
    } catch (error) {
      console.error(
        `[Tender Scraper Engine] Failed to scrape ${source.short_name}:`,
        error
      );
      results.push({
        success: false,
        tendersFound: 0,
        tendersNew: 0,
        tendersUpdated: 0,
        tendersFailed: 0,
        errors: [
          error instanceof Error ? error.message : 'Unknown error',
        ],
      });
    }
  }

  return results;
}
