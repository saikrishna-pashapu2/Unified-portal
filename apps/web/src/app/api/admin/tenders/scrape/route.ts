/**
 * API Route: Manual Tender Scraper Trigger
 * POST /api/admin/tenders/scrape
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/nextauth-options';
import { scrapeTenders } from '@/lib/tenders/scraper-engine';
// Import scrapers to ensure they are registered
import '@/lib/tenders/scrapers';

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user is admin (adjust based on your auth system)
    // const user = await db.users.findUnique({
    //   where: { email: session.user.email! },
    // });
    // if (!user?.is_admin) {
    //   return NextResponse.json(
    //     { error: 'Forbidden: Admin access required' },
    //     { status: 403 }
    //   );
    // }

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
