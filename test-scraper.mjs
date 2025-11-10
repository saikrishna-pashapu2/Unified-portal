/**
 * Test Script: Run Tender Scraper Manually
 * Usage: node --loader ts-node/esm test-scraper.mjs
 */

import { scrapeTenders } from './apps/web/src/lib/tenders/scraper';

async function main() {
  console.log('='.repeat(60));
  console.log('TENDER SCRAPER TEST');
  console.log('='.repeat(60));
  console.log('');

  try {
    const result = await scrapeTenders('mitwork_kz');
    
    console.log('');
    console.log('='.repeat(60));
    console.log('SCRAPE COMPLETED');
    console.log('='.repeat(60));
    console.log('Success:', result.success);
    console.log('Tenders Found:', result.tendersFound);
    console.log('Tenders New:', result.tendersNew);
    console.log('Tenders Updated:', result.tendersUpdated);
    console.log('Tenders Failed:', result.tendersFailed);
    
    if (result.errors.length > 0) {
      console.log('');
      console.log('Errors:');
      result.errors.forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err}`);
      });
    }
    
  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('SCRAPER FAILED');
    console.error('='.repeat(60));
    console.error(error);
  }
}

main();
