/**
 * API Route: Manual Tender Scraper Trigger
 * POST /api/admin/tenders/scrape
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/api-auth';
import { scrapeTenders } from '@/lib/tenders/scraper-engine';
// Import scrapers to ensure they are registered
import '@/lib/tenders/scrapers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminSession();
    if (auth.response) return auth.response;

    const body = await request.json();
    const sourceShortName = body.source || 'mitwork_kz';

    console.log(`[API] Starting manual scrape for: ${sourceShortName}`);

    // Run scraper
    const result = await scrapeTenders(sourceShortName);

    return NextResponse.json({
      success: result.success,
      message: `Scrape completed: ${result.tendersNew} new, ${result.tendersFailed} failed`,
      data: result,
    });

  } catch (error) {
    console.error('[API] Scrape error:', error);
    return NextResponse.json(
      { 
        error: 'Scraping failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
