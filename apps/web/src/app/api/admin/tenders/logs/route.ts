/**
 * API Route: Get Tender Scrape Logs
 * GET /api/admin/tenders/logs
 */

import { NextRequest, NextResponse } from 'next/server';
import { esgPrisma as db } from '@esgcredit/db-esg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

    const logs = await db.tender_scrape_logs.findMany({
      orderBy: {
        started_at: 'desc',
      },
      take: limit,
    });

    return NextResponse.json({
      success: true,
      data: logs,
    });

  } catch (error) {
    console.error('[API] Tender logs error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch tender logs',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
