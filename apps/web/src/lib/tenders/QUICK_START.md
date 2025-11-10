# Quick Start: Adding a New Tender Source

## 🚀 5-Minute Setup

### 1. Create Scraper File

`apps/web/src/lib/tenders/scrapers/example-source.ts`

```typescript
import * as cheerio from 'cheerio';
import { BaseTenderScraper, TenderListItem, TenderDetail, ParsedDates, ScraperConfig } from './base';

export class ExampleSourceScraper extends BaseTenderScraper {
  readonly sourceShortName = 'example_source';

  async scrapeListPages(baseUrl: string, config: ScraperConfig): Promise<TenderListItem[]> {
    const tenders: TenderListItem[] = [];
    const url = `${baseUrl}/tenders?keyword=${config.searchKeywords?.[0] || 'esg'}`;
    
    const response = await this.fetchWithRetry(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    $('.tender-item').each((_, el) => {
      tenders.push({
        lotId: $(el).attr('data-id') || '',
        tenderNumber: $(el).find('.number').text().trim(),
        title: $(el).find('.title').text().trim(),
        customer: $(el).find('.customer').text().trim(),
        amount: $(el).find('.amount').text().trim(),
        deadline: $(el).find('.deadline').text().trim(),
        status: $(el).find('.status').text().trim(),
        url: baseUrl + $(el).find('a').attr('href'),
      });
    });

    return tenders;
  }

  async scrapeTenderDetail(url: string, baseUrl: string): Promise<TenderDetail | null> {
    const response = await this.fetchWithRetry(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    return {
      lotId: $('#lot-id').text().trim(),
      tenderNumber: $('#tender-number').text().trim(),
      title: $('#title').text().trim(),
      description: $('#description').text().trim(),
      totalAmount: $('#amount').text().trim(),
      customerName: $('#customer').text().trim(),
      status: $('#status').text().trim(),
    };
  }

  parseDates(detail: TenderDetail): ParsedDates {
    // Adjust date parsing to your source's format
    return {
      published: new Date(detail.applicationDates?.split('-')[0] || ''),
      applicationEnd: new Date(detail.applicationDates?.split('-')[1] || ''),
    };
  }
}
```

### 2. Register Scraper

Add to `apps/web/src/lib/tenders/scrapers/index.ts`:

```typescript
import { ExampleSourceScraper } from './example-source';

scraperRegistry.register(new ExampleSourceScraper());

export * from './example-source';
```

### 3. Add Database Record

```sql
INSERT INTO tender_sources (
  name, 
  short_name, 
  base_url, 
  country, 
  is_active,
  scraper_config
) VALUES (
  'Example Source',
  'example_source',  -- Must match scraper's sourceShortName
  'https://example.com',
  'US',
  true,
  '{"searchKeywords": ["esg"], "maxPages": 5}'::jsonb
);
```

### 4. Test It!

```bash
# Via API
curl -X POST http://localhost:3000/api/admin/tenders/scrape \
  -H "Content-Type: application/json" \
  -d '{"source": "example_source"}'

# Or via Admin UI
# Visit: http://localhost:3000/admin/tenders
# Click "Run Scraper" on your source
```

## 📋 Scraper Checklist

- [ ] Scraper class extends `BaseTenderScraper`
- [ ] `sourceShortName` matches database `short_name`
- [ ] Implements all required methods
- [ ] Registered in `scrapers/index.ts`
- [ ] Database record created with matching `short_name`
- [ ] `is_active = true` in database
- [ ] Tested with real data

## 🔍 Common Selectors by Site Type

### Government Sites (Table-based)
```typescript
$('table.tenders tr').each((_, row) => {
  const cells = $(row).find('td');
  const title = $(cells[1]).text().trim();
  const amount = $(cells[3]).text().trim();
});
```

### Modern Sites (Card-based)
```typescript
$('.tender-card').each((_, card) => {
  const title = $(card).find('h3.title').text().trim();
  const amount = $(card).find('.price').text().trim();
});
```

### API-based Sources
```typescript
const response = await fetch(`${baseUrl}/api/tenders?query=${keyword}`);
const data = await response.json();
return data.results.map(item => ({ ... }));
```

## 🐛 Debug Tips

### Enable Detailed Logging
```typescript
console.log(`[${this.sourceShortName}] Fetching: ${url}`);
console.log(`[${this.sourceShortName}] Found ${items.length} tenders`);
```

### Test Selectors in Browser
```javascript
// Open source site in browser, then in console:
document.querySelectorAll('.tender-item').length
$('.tender-item').first().find('.title').text()  // If using jQuery
```

### Handle Missing Fields Gracefully
```typescript
const amount = $(el).find('.amount').text().trim() || '0';
const deadline = $(el).find('.deadline').text().trim() || '';
```

## 🌍 Country-Specific Date Formats

### Kazakhstan (Russian)
```typescript
// Format: "с 01 ноября 2025 г. по 31 декабря 2025 г."
const monthMap = {
  'января': 0, 'февраля': 1, 'марта': 2,
  'апреля': 3, 'мая': 4, 'июня': 5,
  'июля': 6, 'августа': 7, 'сентября': 8,
  'октября': 9, 'ноября': 10, 'декабря': 11
};
```

### USA
```typescript
// Format: "10/22/2025" or "October 22, 2025"
const date = new Date(dateStr);
```

### Europe
```typescript
// Format: "22.10.2025" or "22/10/2025"
const [day, month, year] = dateStr.split(/[./-]/);
const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
```

## 💡 Pro Tips

1. **Start Simple**: Get list scraping working first, then add detail scraping
2. **Use Browser DevTools**: Inspect the HTML structure before coding
3. **Test with One Page**: Set `maxPages: 1` in config initially
4. **Handle Errors**: Wrap parsing in try-catch blocks
5. **Be Respectful**: Add delays between requests (1-2 seconds)
6. **Check robots.txt**: Respect website's scraping policies

## 📚 Full Documentation

For detailed architecture and advanced features, see:
- `SCRAPER_ARCHITECTURE.md` - Complete system documentation
- `base.ts` - Base scraper interface and helpers
- `mitwork-kz.ts` - Working example scraper

---

**Need help?** Check existing scrapers in `scrapers/` folder for examples!
