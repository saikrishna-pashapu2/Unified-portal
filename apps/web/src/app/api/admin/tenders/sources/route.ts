/**
 * API Route: Get Tender Sources
 * GET /api/admin/tenders/sources
 */

import { NextRequest, NextResponse } from 'next/server';
import { esgPrisma as db } from '@esgcredit/db-esg';

export async function GET(request: NextRequest) {
  try {
    const sources = await db.tender_sources.findMany({
      orderBy: {
        created_at: 'desc',
      },
    });

    return NextResponse.json({
      success: true,
      data: sources,
    });

  } catch (error) {
    console.error('[API] Tender sources error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch tender sources',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
