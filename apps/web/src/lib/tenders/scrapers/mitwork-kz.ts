/**
 * Mitwork.kz Tender Scraper
 * Scrapes tenders from eep.mitwork.kz
 */

import * as cheerio from 'cheerio';
import {
  BaseTenderScraper,
  TenderListItem,
  TenderDetail,
  ParsedDates,
  ScraperConfig,
} from './base';

export class MitworkKzScraper extends BaseTenderScraper {
  readonly sourceShortName = 'mitwork_kz';

  /**
   * Scrape tender list pages
   */
  async scrapeListPages(
    baseUrl: string,
    config: ScraperConfig
  ): Promise<TenderListItem[]> {
    const tenders: TenderListItem[] = [];
    const searchKeyword = config.searchKeywords?.[0] || 'esg';

    console.log(`[${this.sourceShortName}] Searching for: "${searchKeyword}"`);

    // First, detect total number of pages
    let totalPages = 1;
    try {
      const firstPageUrl = `${baseUrl}/ru/publics/lots?filter[submit]=&filter%5Bsearch%5D=${searchKeyword}&filter%5Blot_status%5D=EMPTY&filter%5Bis_preliminary%5D=0`;
      const response = await this.fetchWithRetry(firstPageUrl);

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

        console.log(`[${this.sourceShortName}] Detected ${totalPages} total pages`);
      }
    } catch (error) {
      console.error(`[${this.sourceShortName}] Failed to detect total pages, defaulting to 10:`, error);
      totalPages = config.maxPages || 10;
    }

    // Limit pages if configured
    if (config.maxPages && config.maxPages < totalPages) {
      totalPages = config.maxPages;
    }

    // Now scrape all pages
    for (let page = 1; page <= totalPages; page++) {
      try {
        const url = `${baseUrl}/ru/publics/lots?filter[submit]=&filter%5Bsearch%5D=${searchKeyword}&filter%5Blot_status%5D=EMPTY&filter%5Bis_preliminary%5D=0&page=${page}`;
        console.log(`[${this.sourceShortName}] Fetching page ${page}/${totalPages}: ${url}`);

        const response = await this.fetchWithRetry(url);

        if (!response.ok) {
          console.warn(`[${this.sourceShortName}] Page ${page} returned status ${response.status}`);
          break;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // Use the correct selector - table rows with class "item"
        const items = $('tr.item');

        console.log(`[${this.sourceShortName}] Found ${items.length} items on page ${page}`);

        if (items.length === 0) {
          console.log(`[${this.sourceShortName}] No more items, stopping at page ${page}`);
          break;
        }

        items.each((_, element) => {
          try {
            const $item = $(element);

            // Get lot ID from data-key attribute
            const lotId = $item.attr('data-key') || '';

            if (!lotId) {
              console.warn(`[${this.sourceShortName}] No lot ID found, skipping item`);
              return;
            }

            // Extract data from table cells
            const cells = $item.find('td');

            const tenderNumber = $(cells[0]).text().trim();
            const titleCell = $(cells[1]);
            const title = titleCell.find('a.word-break').text().trim();
            const amount = $(cells[3]).text().trim();
            const customer = $(cells[4]).find('a').text().trim();
            const status = $(cells[5]).text().trim();

            // Get URL
            const href = titleCell.find('a.word-break').attr('href') || '';

            // Check if already added (avoid duplicates)
            const alreadyExists = tenders.some((t) => t.lotId === lotId);
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
            console.error(`[${this.sourceShortName}] Error parsing list item:`, error);
          }
        });

        // Delay between pages
        await this.delay(1000);
      } catch (error) {
        console.error(`[${this.sourceShortName}] Error fetching page ${page}:`, error);
        break;
      }
    }

    console.log(`[${this.sourceShortName}] Total tenders found: ${tenders.length}`);

    return tenders;
  }

  /**
   * Scrape detailed information from a single tender page
   */
  async scrapeTenderDetail(
    url: string,
    baseUrl: string
  ): Promise<TenderDetail | null> {
    try {
      console.log(`[${this.sourceShortName}] Fetching detail: ${url}`);

      const response = await this.fetchWithRetry(url);

      if (!response.ok) {
        console.warn(`[${this.sourceShortName}] Detail page returned status ${response.status}`);
        return null;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const detail: TenderDetail = {
        lotId: '',
        tenderNumber: '',
        title: '',
      };

      // Extract from table.detail-view
      const detailTable = $('table.detail-view');

      detailTable.find('tr').each((_, row) => {
        const $row = $(row);
        const label = $row.find('th').text().trim();
        const $td = $row.find('td');

        // For date fields, extract only the text node before any span tags
        const getValue = () => {
          if (
            label.includes('Дата начала') ||
            label.includes('Дата окончания') ||
            label.includes('начала/окончания приема заявок')
          ) {
            return $td.contents().first().text().trim();
          }
          return $td.text().trim();
        };

        const value = getValue();

        // Map Russian labels to fields
        if (label.includes('Номер лота')) {
          detail.lotId = value;
        } else if (label.includes('Номер объявления')) {
          detail.tenderNumber = value;
        } else if (label.includes('Наименование лота')) {
          detail.title = value;
        } else if (label.includes('Описание лота')) {
          detail.description = value;
        } else if (label.includes('Дополнительная информация')) {
          detail.additionalInfo = value;
        } else if (label.includes('Код КТРУ')) {
          detail.ktruCode = value;
        } else if (label.includes('Способ закупки')) {
          detail.procurementMethod = value;
        } else if (label.includes('Вид закупки')) {
          detail.procurementType = value;
        } else if (label.includes('Планируемая сумма')) {
          detail.totalAmount = value;
        } else if (label.includes('Авансовый платеж')) {
          detail.advancePayment = value;
        } else if (label.includes('начала/окончания приема заявок')) {
          detail.applicationDates = value;
        } else if (label.includes('Срок договора')) {
          detail.contractPeriod = value;
        } else if (label.includes('Условия поставки')) {
          detail.deliveryTerms = value;
        } else if (label.includes('Наименование заказчика')) {
          detail.customerName = value;
        } else if (label.includes('БИН заказчика')) {
          detail.customerBin = value;
        } else if (label.includes('Статус')) {
          detail.status = value;
        }
      });

      // Also check the "Сведения об объявлении и закупе" table
      const announcementTable = $('table.table')
        .filter((_, table) => {
          return $(table).find('caption').text().includes('Сведения об объявлении');
        })
        .first();

      announcementTable.find('tr').each((_, row) => {
        const $row = $(row);
        const label = $row.find('th').text().trim();
        const $td = $row.find('td');
        const value = $td.contents().first().text().trim();

        if (label.includes('Дата начала') && !detail.applicationDates) {
          detail.applicationDates = value;
        }
      });

      return detail;
    } catch (error) {
      console.error(`[${this.sourceShortName}] Error scraping detail:`, error);
      return null;
    }
  }

  /**
   * Parse dates from tender detail
   */
  parseDates(detail: TenderDetail): ParsedDates {
    const result: ParsedDates = {};

    try {
      // Parse application dates (format: "2025-10-20 09:00:00 - 2025-10-30 18:00:00")
      if (detail.applicationDates) {
        const dates = detail.applicationDates
          .split('-')
          .map((d) => d.trim())
          .filter((d) => d.length > 0);

        if (dates.length >= 2) {
          const startDate = new Date(dates[0].trim());
          result.applicationStart = isNaN(startDate.getTime()) ? null : startDate;

          const endDate = new Date(dates[1].trim());
          result.applicationEnd = isNaN(endDate.getTime()) ? null : endDate;
        }
      }

      // Parse contract period (format: "с 01 ноября 2025 г. по 31 декабря 2025 г.")
      if (detail.contractPeriod) {
        const monthMap: Record<string, number> = {
          января: 0,
          февраля: 1,
          марта: 2,
          апреля: 3,
          мая: 4,
          июня: 5,
          июля: 6,
          августа: 7,
          сентября: 8,
          октября: 9,
          ноября: 10,
          декабря: 11,
        };

        const parts = detail.contractPeriod.split('по').map((p) => p.trim());

        if (parts.length === 2) {
          // Parse start date
          const startMatch = parts[0].match(/(\d+)\s+(\w+)\s+(\d{4})/);
          if (startMatch) {
            const day = parseInt(startMatch[1]);
            const month = monthMap[startMatch[2]] ?? 0;
            const year = parseInt(startMatch[3]);
            result.contractStart = new Date(year, month, day);
          }

          // Parse end date
          const endMatch = parts[1].match(/(\d+)\s+(\w+)\s+(\d{4})/);
          if (endMatch) {
            const day = parseInt(endMatch[1]);
            const month = monthMap[endMatch[2]] ?? 0;
            const year = parseInt(endMatch[3]);
            result.contractEnd = new Date(year, month, day);
          }
        }
      }

      // Use application start as published date if available
      if (result.applicationStart) {
        result.published = result.applicationStart;
      }
    } catch (error) {
      console.error(`[${this.sourceShortName}] Error parsing dates:`, error);
    }

    return result;
  }

  /**
   * Validate if tender should be processed
   */
  shouldProcess(detail: TenderDetail, config: ScraperConfig): boolean {
    // Always process for mitwork.kz since we already filtered by "esg" keyword
    return true;
  }
}
