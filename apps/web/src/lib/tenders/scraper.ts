/**
 * Tender Scraper Service
 * Scrapes tender data from mitwork.kz and other sources
 */

import * as cheerio from 'cheerio';
import { esgPrisma as db } from '@esgcredit/db-esg';
import { translateTender } from './translator-simple';

interface ScrapeResult {
  success: boolean;
  tendersFound: number;
  tendersNew: number;
  tendersUpdated: number;
  tendersFailed: number;
  errors: string[];
}

interface TenderListItem {
  lotId: string;
  tenderNumber: string;
  title: string;
  customer: string;
  amount: string;
  deadline: string;
  status: string;
  url: string;
}

interface TenderDetail {
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

/**
 * Main scraper function
 */
export async function scrapeTenders(sourceShortName: string = 'mitwork_kz'): Promise<ScrapeResult> {
  const startTime = Date.now();
  
  console.log(`[Tender Scraper] Starting scrape for: ${sourceShortName}`);
  
  const result: ScrapeResult = {
    success: false,
    tendersFound: 0,
    tendersNew: 0,
    tendersUpdated: 0,
    tendersFailed: 0,
    errors: [],
  };

  try {
    // Get source configuration
    const source = await db.tender_sources.findUnique({
      where: { short_name: sourceShortName },
    });

    if (!source) {
      throw new Error(`Source not found: ${sourceShortName}`);
    }

    if (!source.is_active) {
      throw new Error(`Source is inactive: ${sourceShortName}`);
    }

    // Create scrape log
    const scrapeLog = await db.tender_scrape_logs.create({
      data: {
        source_id: source.id,
        started_at: new Date(),
        status: 'running',
        trigger_type: 'manual',
        scraper_version: '1.0.0',
      },
    });

    console.log(`[Tender Scraper] Scrape log created: ${scrapeLog.id}`);

    // Parse scraper config
    const config = source.scraper_config as any;
    const baseUrl = source.base_url;

    // Step 1: Scrape list pages
    const tenderList = await scrapeListPages(baseUrl, config);
    result.tendersFound = tenderList.length;

    console.log(`[Tender Scraper] Found ${tenderList.length} tenders on list pages`);

    // Step 2: Process each tender
    for (const listItem of tenderList) {
      try {
        await processTender(listItem, source.id, baseUrl, config);
        result.tendersNew++;
      } catch (error) {
        console.error(`[Tender Scraper] Failed to process tender ${listItem.lotId}:`, error);
        result.tendersFailed++;
        result.errors.push(`Tender ${listItem.lotId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
        error_message: result.errors.length > 0 ? result.errors.join('\n') : null,
      },
    });

    // Update source statistics
    await db.tender_sources.update({
      where: { id: source.id },
      data: {
        last_scrape_date: new Date(),
        last_scrape_status: result.tendersFailed > 0 ? 'partial' : 'success',
        total_scrapes: { increment: 1 },
        successful_scrapes: result.tendersFailed === 0 ? { increment: 1 } : undefined,
        failed_scrapes: result.tendersFailed > 0 ? { increment: 1 } : undefined,
      },
    });

    result.success = true;
    console.log(`[Tender Scraper] Completed in ${duration}s:`, result);

  } catch (error) {
    console.error('[Tender Scraper] Fatal error:', error);
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
  }

  return result;
}

/**
 * Scrape tender list pages
 */
async function scrapeListPages(baseUrl: string, config: any): Promise<TenderListItem[]> {
  const tenders: TenderListItem[] = [];
  const searchKeyword = 'esg'; // Only search for ESG tenders

  console.log(`[Tender Scraper] Searching for: "${searchKeyword}"`);

  // First, detect total number of pages
  let totalPages = 1;
  try {
    const firstPageUrl = `${baseUrl}/ru/publics/lots?filter[submit]=&filter%5Bsearch%5D=esg&filter%5Blot_status%5D=EMPTY&filter%5Bis_preliminary%5D=0`;
    const response = await fetch(firstPageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
    });

    if (response.ok) {
      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Find pagination links
      const paginationLinks = $('ul.pagination li a');
      paginationLinks.each((_, element) => {
        const pageNum = parseInt($(element).text().trim());
        if (!isNaN(pageNum) && pageNum > totalPages) {
          totalPages = pageNum;
        }
      });
      
      console.log(`[Tender Scraper] Detected ${totalPages} total pages`);
    }
  } catch (error) {
    console.error('[Tender Scraper] Failed to detect total pages, defaulting to 10:', error);
    totalPages = 10;
  }

  // Now scrape all pages
  for (let page = 1; page <= totalPages; page++) {
    try {
      const url = `${baseUrl}/ru/publics/lots?filter[submit]=&filter%5Bsearch%5D=esg&filter%5Blot_status%5D=EMPTY&filter%5Bis_preliminary%5D=0`;
      console.log(`[Tender Scraper] Fetching page ${page}/${totalPages}: ${url}`);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        },
      });

      if (!response.ok) {
        console.warn(`[Tender Scraper] Page ${page} returned status ${response.status}`);
        break;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Use the correct selector - table rows with class "item"
      const items = $('tr.item');

      console.log(`[Tender Scraper] Found ${items.length} items on page ${page}`);

      if (items.length === 0) {
        console.log(`[Tender Scraper] No more items, stopping at page ${page}`);
        break;
      }

      items.each((_, element) => {
        try {
          const $item = $(element);
          
          // Get lot ID from data-key attribute
          const lotId = $item.attr('data-key') || '';

          if (!lotId) {
            console.warn('[Tender Scraper] No lot ID found, skipping item');
            return;
          }

          // Extract data from table cells
          const cells = $item.find('td');
          
          const tenderNumber = $(cells[0]).text().trim();
          const titleCell = $(cells[1]);
          const title = titleCell.find('a.word-break').text().trim();
          const ktruCode = titleCell.find('span.label').text().trim();
          const description = $(cells[2]).text().trim();
          const amount = $(cells[3]).text().trim();
          const customer = $(cells[4]).find('a').text().trim();
          const status = $(cells[5]).text().trim();
          
          // Get URL
          const href = titleCell.find('a.word-break').attr('href') || '';

          // Check if already added (avoid duplicates within same search)
          const alreadyExists = tenders.some(t => t.lotId === lotId);
          if (!alreadyExists) {
            tenders.push({
              lotId,
              tenderNumber,
              title,
              customer,
              amount,
              deadline: '', // Not available in list
              status,
              url: href.startsWith('http') ? href : `${baseUrl}${href}`,
            });
          }
        } catch (error) {
          console.error('[Tender Scraper] Error parsing list item:', error);
        }
      });

      // Small delay between pages to be polite
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`[Tender Scraper] Error fetching page ${page}:`, error);
      break;
    }
  }

  console.log(`[Tender Scraper] Total tenders found: ${tenders.length}`);

  return tenders;
}

/**
 * Process individual tender (fetch details, translate, classify, save)
 */
async function processTender(
  listItem: TenderListItem,
  sourceId: number,
  baseUrl: string,
  config: any
): Promise<void> {
  console.log(`[Tender Scraper] Processing tender: ${listItem.lotId}`);

  // Check if tender already exists
  const existing = await db.tenders.findFirst({
    where: {
      source_id: sourceId,
      lot_id: listItem.lotId,
    },
  });

  if (existing) {
    console.log(`[Tender Scraper] Tender ${listItem.lotId} already exists, skipping`);
    return;
  }

  // Fetch tender details
  const details = await scrapeTenderDetail(listItem.url, config);

  // Translate (NO classification - all are ESG domain)
  console.log(`[Tender Scraper] Translating tender ${listItem.lotId}...`);
  const translated = await translateTender({
    title: details.title,
    description: details.description,
    additionalInfo: details.additionalInfo,
    deliveryTerms: details.deliveryTerms,
    status: details.status,
    customerName: details.customerName || listItem.customer,
    procurementMethod: details.procurementMethod,
    procurementType: details.procurementType,
  });

  // Parse financial data
  const totalAmount = parseAmount(details.totalAmount);
  const advancePayment = parseAmount(details.advancePayment);

  // Parse dates
  const dates = parseDates(details.applicationDates, details.contractPeriod);

  // Save to database
  const tender = await db.tenders.create({
    data: {
      source_id: sourceId,
      lot_id: listItem.lotId,
      tender_number: details.tenderNumber || listItem.tenderNumber,
      tender_url: listItem.url,
      
      // Original content
      original_title: details.title,
      original_description: details.description || null,
      original_additional_info: details.additionalInfo || null,
      original_delivery_terms: details.deliveryTerms || null,
      original_language: 'ru',
      
      // Translated content (English)
      title: translated.title,
      description: translated.description,
      additional_info: translated.additionalInfo,
      delivery_terms: translated.deliveryTerms,
      
      // Financial
      total_amount: totalAmount,
      currency: 'KZT',
      advance_payment: advancePayment,
      
      // Classification
      ktru_code: details.ktruCode || null,
      procurement_method: translated.procurementMethod,
      procurement_type: translated.procurementType,
      
      // Direct ESG classification (no AI needed for this source)
      primary_domain: 'esg',
      domain_classification: {
        esg: 100,
        credit: 0,
      },
      matched_keywords: {
        esg: ['esg', 'sustainability', 'environmental'],
        credit: [],
      },
      ai_summary: 'Tender from ESG-focused procurement portal',
      classification_date: new Date(),
      classification_confidence: 1.0,
      
      // Customer
      customer_name: translated.customerName || details.customerName || listItem.customer,
      customer_bin: details.customerBin || null,
      
      // Dates (use actual dates from the tender, not today's date!)
      published_date: dates.applicationStart || dates.applicationEnd || null,
      application_start_date: dates.applicationStart || null,
      application_end_date: dates.applicationEnd || null,
      contract_start_date: dates.contractStart || null,
      contract_end_date: dates.contractEnd || null,
      
      // Status
      original_status: details.status || listItem.status,
      status: translated.status || 'active',
      is_active: true,
    },
  });

  console.log(`[Tender Scraper] Tender ${listItem.lotId} saved with ID: ${tender.id} (ESG domain)`);

  // Record translation
  await db.tender_translations.create({
    data: {
      tender_id: tender.id,
      source_language: 'ru',
      target_language: 'en',
      total_characters: (details.title + (details.description || '')).length,
      translation_method: 'openai',
      translation_cost: translated.cost,
      translation_time_ms: translated.timeMs,
    },
  });

  // Record classification (direct ESG assignment, no AI classification needed)
  await db.tender_classifications.create({
    data: {
      tender_id: tender.id,
      esg_score: 1.0,
      credit_score: 0.0,
      primary_domain: 'esg',
      reasoning: 'Tender from ESG-focused procurement portal - directly classified as ESG domain',
      esg_keywords: ['esg', 'sustainability', 'environmental'],
      credit_keywords: [],
      model_used: 'direct',
      prompt_tokens: 0,
      completion_tokens: 0,
      classification_cost: 0,
      processing_time_ms: 0,
    },
  });
}

/**
 * Scrape individual tender detail page
 */
async function scrapeTenderDetail(url: string, config: any): Promise<TenderDetail> {
  console.log(`[Tender Scraper] Fetching tender details: ${url}`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tender details: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Extract lot ID from URL
  const lotIdMatch = url.match(/\/lot\/(\d+)/);
  const lotId = lotIdMatch ? lotIdMatch[1] : '';

  const detail: TenderDetail = {
    lotId,
    tenderNumber: '',
    title: '',
  };

  // Helper to extract from detail-view table rows
  const extractTableField = (labelText: string): string => {
    let value = '';
    $('table.detail-view tr').each((_, row) => {
      const $row = $(row);
      const th = $row.find('th').text().trim();
      if (th.includes(labelText)) {
        value = $row.find('td').text().trim();
        return false; // break
      }
    });
    return value;
  };

  // Extract title from page header
  detail.title = $('h1.page-title').text().trim();
  
  // Extract from first detail table (Lot information)
  detail.description = extractTableField('Описание на русском языке');
  detail.additionalInfo = extractTableField('Дополнительная характеристика на русском языке');
  detail.ktruCode = extractTableField('Код КТРУ');
  detail.deliveryTerms = extractTableField('Срок поставки на русском языке');
  detail.totalAmount = extractTableField('Расчет полной стоимости');
  detail.advancePayment = extractTableField('Расчет авансового платежа');
  
  // Extract customer
  const customerLink = $('table.detail-view tr:contains("Заказчик") td a');
  detail.customerName = customerLink.text().trim();

  // Extract from second detail table (Buy/Announcement information)
  let applicationStartDate = '';
  let applicationEndDate = '';
  
  $('table.detail-view').eq(1).find('tr').each((_, row) => {
    const $row = $(row);
    const th = $row.find('th').text().trim();
    const $td = $row.find('td');
    
    if (th.includes('Дата начала приема заявок')) {
      applicationStartDate = $td.contents().first().text().trim();
    } else if (th.includes('Дата окончания приема заявок')) {
      // Get only the date part, before any span tags
      applicationEndDate = $td.contents().first().text().trim();
    } else if (th.includes('Способ закупки')) {
      detail.procurementMethod = $td.text().split('\n')[0].trim();
    } else if (th.includes('Статус')) {
      detail.status = $td.text().trim();
    } else if (th.includes('Тип закупки')) {
      detail.procurementType = $td.text().trim();
    }
  });
  
  // Store the dates
  detail.applicationDates = applicationStartDate && applicationEndDate 
    ? `${applicationStartDate} - ${applicationEndDate}`
    : applicationEndDate || applicationStartDate;

  // Extract tender number from announcement link
  const announcementLink = $('h3 a[href*="/publics/buy/"]');
  if (announcementLink.length > 0) {
    detail.tenderNumber = announcementLink.text().trim();
  }

  console.log(`[Tender Scraper] Extracted tender: ${detail.title}`);

  return detail;
}

/**
 * Parse amount string to decimal
 */
function parseAmount(amountStr?: string): number | null {
  if (!amountStr) return null;
  
  // Remove currency symbols and spaces
  const cleaned = amountStr.replace(/[^\d.,]/g, '');
  
  // Remove spaces used as thousand separators
  const normalized = cleaned.replace(/\s/g, '').replace(',', '.');
  
  const amount = parseFloat(normalized);
  return isNaN(amount) ? null : amount;
}

/**
 * Parse date strings
 */
function parseDates(applicationDates?: string, contractPeriod?: string) {
  const result: {
    applicationStart: Date | null;
    applicationEnd: Date | null;
    contractStart: Date | null;
    contractEnd: Date | null;
  } = {
    applicationStart: null,
    applicationEnd: null,
    contractStart: null,
    contractEnd: null,
  };

  // Parse application dates
  if (applicationDates) {
    // Format: "2025-10-20 09:00:00 - 2025-10-23 09:30:00" or just "2025-10-23 09:30:00"
    const dates = applicationDates.split(' - ');
    
    if (dates.length === 2) {
      // Has both start and end dates
      const startDate = new Date(dates[0].trim());
      const endDate = new Date(dates[1].trim());
      
      result.applicationStart = isNaN(startDate.getTime()) ? null : startDate;
      result.applicationEnd = isNaN(endDate.getTime()) ? null : endDate;
    } else if (dates.length === 1) {
      // Only has one date (likely end date)
      const singleDate = new Date(dates[0].trim());
      result.applicationEnd = isNaN(singleDate.getTime()) ? null : singleDate;
    }
  }

  // Parse contract period (e.g., "по декабрь 2027 г.")
  if (contractPeriod) {
    // This is in Russian text format, try to extract year
    const yearMatch = contractPeriod.match(/(\d{4})/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      // Try to extract month
      const monthNames: Record<string, number> = {
        'январь': 0, 'февраль': 1, 'март': 2, 'апрель': 3,
        'май': 4, 'июнь': 5, 'июль': 6, 'август': 7,
        'сентябрь': 8, 'октябрь': 9, 'ноябрь': 10, 'декабрь': 11
      };
      
      for (const [monthName, monthIndex] of Object.entries(monthNames)) {
        if (contractPeriod.toLowerCase().includes(monthName)) {
          result.contractEnd = new Date(year, monthIndex, 1);
          break;
        }
      }
      
      if (!result.contractEnd) {
        // Default to December if month not found
        result.contractEnd = new Date(year, 11, 31);
      }
    }
  }

  return result;
}
