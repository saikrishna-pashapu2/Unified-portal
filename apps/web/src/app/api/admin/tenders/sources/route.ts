/**
 * API Route: Get Tender Sources
 * GET /api/admin/tenders/sources
 */

import { NextRequest, NextResponse } from 'next/server';
import { esgPrisma as db } from '@esgcredit/db-esg';
import { requireAdminSession } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminSession();
    if (auth.response) return auth.response;

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
