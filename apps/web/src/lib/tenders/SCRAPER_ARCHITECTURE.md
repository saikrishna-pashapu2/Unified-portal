# Tender Scraper System - Scalable Architecture

## Overview

The tender scraping system has been refactored to support multiple tender sources through a **registry pattern**. This makes it easy to add new tender sources without modifying the core scraping engine.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Scraper Engine                            │
│  (scraper-engine.ts - Universal orchestrator)                │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ├──> Scraper Registry
                   │    (Manages all registered scrapers)
                   │
         ┌─────────┴─────────┐
         │                   │
    ┌────▼────┐         ┌────▼────┐         ┌──────────┐
    │ Mitwork │         │ Zakupki │         │  Future  │
    │   KZ    │         │ Gov RU  │         │ Scrapers │
    └─────────┘         └─────────┘         └──────────┘
```

## File Structure

```
apps/web/src/lib/tenders/
├── scraper-engine.ts          # Universal scraper engine
├── scrapers/
│   ├── base.ts                # Base scraper interface & abstract class
│   ├── registry.ts            # Scraper registry
│   ├── mitwork-kz.ts          # Mitwork.kz scraper implementation
│   ├── zakupki-gov-ru.ts      # Zakupki.gov.ru scraper (template)
│   └── index.ts               # Auto-registration & exports
├── translator-simple.ts       # Translation service
└── scraper.ts                 # Legacy scraper (kept for reference)
```

## How It Works

### 1. Base Scraper Interface

All scrapers implement the `ITenderScraper` interface:

```typescript
interface ITenderScraper {
  readonly sourceShortName: string;
  
  scrapeListPages(baseUrl: string, config: ScraperConfig): Promise<TenderListItem[]>;
  scrapeTenderDetail(url: string, baseUrl: string): Promise<TenderDetail | null>;
  parseDates(detail: TenderDetail): ParsedDates;
  shouldProcess?(detail: TenderDetail, config: ScraperConfig): boolean;
}
```

### 2. Registry Pattern

The registry manages all available scrapers:

```typescript
import { scraperRegistry } from './scrapers/registry';

// Register a scraper
scraperRegistry.register(new MitworkKzScraper());

// Get a scraper
const scraper = scraperRegistry.get('mitwork_kz');
```

### 3. Scraper Engine

The engine is source-agnostic and delegates to the appropriate scraper:

```typescript
import { scrapeTenders } from './scraper-engine';

// Scrape from a specific source
const result = await scrapeTenders('mitwork_kz');
```

## Adding a New Tender Source

### Step 1: Create Scraper Class

Create a new file: `scrapers/your-source.ts`

```typescript
import * as cheerio from 'cheerio';
import {
  BaseTenderScraper,
  TenderListItem,
  TenderDetail,
  ParsedDates,
  ScraperConfig,
} from './base';

export class YourSourceScraper extends BaseTenderScraper {
  readonly sourceShortName = 'your_source';

  async scrapeListPages(baseUrl: string, config: ScraperConfig): Promise<TenderListItem[]> {
    const tenders: TenderListItem[] = [];
    
    // Your scraping logic here
    // Use this.fetchWithRetry() for HTTP requests
    // Use this.delay() for rate limiting
    
    return tenders;
  }

  async scrapeTenderDetail(url: string, baseUrl: string): Promise<TenderDetail | null> {
    // Fetch and parse tender detail page
    const response = await this.fetchWithRetry(url);
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Extract details
    const detail: TenderDetail = {
      lotId: '',
      tenderNumber: '',
      title: '',
      // ... extract other fields
    };
    
    return detail;
  }

  parseDates(detail: TenderDetail): ParsedDates {
    // Parse dates from your source's format
    return {
      published: new Date(),
      applicationStart: new Date(),
      applicationEnd: new Date(),
    };
  }

  shouldProcess(detail: TenderDetail, config: ScraperConfig): boolean {
    // Filter logic (e.g., check for ESG keywords)
    return true;
  }
}
```

### Step 2: Register the Scraper

Add to `scrapers/index.ts`:

```typescript
import { YourSourceScraper } from './your-source';

// Register it
scraperRegistry.register(new YourSourceScraper());

// Export it
export * from './your-source';
```

### Step 3: Add Database Record

Insert into `tender_sources` table:

```sql
INSERT INTO tender_sources (
  name, 
  short_name, 
  base_url, 
  country, 
  is_active, 
  scrape_frequency_hours,
  scraper_config
) VALUES (
  'Your Source Name',
  'your_source',  -- Must match sourceShortName
  'https://your-source.com',
  'KZ',
  true,
  24,
  '{
    "searchKeywords": ["esg", "environment"],
    "maxPages": 10
  }'::jsonb
);
```

### Step 4: Test Your Scraper

```typescript
import { scrapeTenders } from '@/lib/tenders/scraper-engine';

const result = await scrapeTenders('your_source');
console.log(result);
```

## Helper Methods in BaseTenderScraper

The `BaseTenderScraper` class provides useful helper methods:

### HTTP Requests
```typescript
// Fetch with automatic retry and exponential backoff
const response = await this.fetchWithRetry(url, options, maxRetries);
```

### Rate Limiting
```typescript
// Delay between requests
await this.delay(1000); // 1 second
```

### Currency Extraction
```typescript
const currency = this.extractCurrency('5000 ₸'); // Returns 'KZT'
const currency = this.extractCurrency('$1000');   // Returns 'USD'
```

### Amount Extraction
```typescript
const amount = this.extractAmount('5,000.00 ₸'); // Returns 5000
```

## Configuration via Database

Each scraper can be configured through `tender_sources.scraper_config` (JSON field):

```json
{
  "searchKeywords": ["esg", "экология", "green"],
  "maxPages": 10,
  "pageSize": 20,
  "filters": {
    "status": "published",
    "minAmount": 100000
  }
}
```

Access in scraper:
```typescript
const keywords = config.searchKeywords || ['esg'];
const maxPages = config.maxPages || 10;
```

## Scraping Flow

1. **Engine** fetches source config from database
2. **Engine** gets appropriate scraper from registry
3. **Scraper** scrapes list pages → Returns `TenderListItem[]`
4. For each tender:
   - **Scraper** scrapes detail page → Returns `TenderDetail`
   - **Scraper** parses dates → Returns `ParsedDates`
   - **Scraper** validates with `shouldProcess()`
   - **Engine** translates content (Russian/Kazakh → English)
   - **Engine** saves to database
5. **Engine** updates scrape logs and statistics

## API Endpoints

### Trigger Scraper
```bash
POST /api/admin/tenders/scrape
Body: { "source": "mitwork_kz" }
```

### Scrape All Active Sources
```typescript
import { scrapeAllActiveSources } from '@/lib/tenders/scraper-engine';

const results = await scrapeAllActiveSources();
```

## Current Scrapers

### ✅ mitwork_kz (Production Ready)
- **URL**: https://eep.mitwork.kz
- **Country**: Kazakhstan
- **Features**:
  - List page pagination
  - Detail page extraction
  - Date parsing (Russian format)
  - ESG keyword filtering

### 🚧 zakupki_gov_ru (Template/Example)
- **URL**: https://zakupki.gov.ru
- **Country**: Russia
- **Status**: Template implementation
- **TODO**: Update selectors for actual site structure

## Future Enhancements

### Planned Features
- [ ] API-based scrapers (REST/GraphQL)
- [ ] CAPTCHA handling
- [ ] Authentication/cookies support
- [ ] Document download & parsing
- [ ] Image scraping
- [ ] Real-time notifications
- [ ] Incremental scraping (only new tenders)
- [ ] Concurrent scraping with worker pool

### Potential Sources
- [ ] **sam.gov** (USA government tenders)
- [ ] **ted.europa.eu** (EU tenders)
- [ ] **goszakup.gov.kz** (Kazakhstan)
- [ ] **zakupki.gov.ru** (Russia)
- [ ] **dgmarket.com** (Development Bank tenders)
- [ ] **undb.online** (UN Development Business)

## Testing

### Unit Test Template
```typescript
import { YourSourceScraper } from './your-source';

describe('YourSourceScraper', () => {
  const scraper = new YourSourceScraper();
  
  it('should scrape list pages', async () => {
    const items = await scraper.scrapeListPages(
      'https://your-source.com',
      { searchKeywords: ['esg'] }
    );
    
    expect(items.length).toBeGreaterThan(0);
  });
  
  it('should parse dates correctly', () => {
    const detail: TenderDetail = {
      lotId: '123',
      tenderNumber: 'T-001',
      title: 'Test',
      applicationDates: '2025-10-20 - 2025-10-30',
    };
    
    const dates = scraper.parseDates(detail);
    
    expect(dates.applicationStart).toBeInstanceOf(Date);
    expect(dates.applicationEnd).toBeInstanceOf(Date);
  });
});
```

## Troubleshooting

### Scraper Not Found
```
Error: No scraper registered for source: your_source
```
**Solution**: Make sure to import `@/lib/tenders/scrapers` to auto-register all scrapers.

### HTML Selectors Not Working
- Website structure changed
- Use browser DevTools to inspect current HTML
- Update selectors in your scraper class

### Rate Limiting / 429 Errors
- Increase delay between requests: `await this.delay(2000)`
- Use `fetchWithRetry()` for automatic retry with backoff

### Date Parsing Errors
- Check date format in source HTML
- Update date parsing logic in `parseDates()`
- Handle multiple date formats if needed

## Performance Tips

1. **Batch Processing**: Process tenders in batches to avoid memory issues
2. **Concurrent Requests**: Use `Promise.all()` for independent requests
3. **Caching**: Cache list pages if scraping multiple times
4. **Incremental Scraping**: Store last scrape timestamp, only fetch new tenders
5. **Database Indexing**: Ensure indexes on `lot_id`, `source_id`, `published_date`

## Monitoring

Monitor scraper performance:

```sql
-- Recent scrape logs
SELECT 
  ts.name,
  tsl.started_at,
  tsl.status,
  tsl.tenders_found,
  tsl.tenders_new,
  tsl.duration_seconds
FROM tender_scrape_logs tsl
JOIN tender_sources ts ON ts.id = tsl.source_id
ORDER BY tsl.started_at DESC
LIMIT 10;

-- Source statistics
SELECT 
  name,
  total_scrapes,
  successful_scrapes,
  failed_scrapes,
  last_scrape_date,
  last_scrape_status
FROM tender_sources
WHERE is_active = true;
```

## Contributing

When adding a new scraper:

1. Follow the `BaseTenderScraper` interface
2. Add comprehensive error handling
3. Include logging for debugging
4. Test with real data
5. Document any source-specific quirks
6. Update this README with source details

---

**Last Updated**: October 22, 2025
**Version**: 2.0.0
