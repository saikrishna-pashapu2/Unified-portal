/**
 * API Route: Tender Detail
 * GET /api/tenders/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import { esgPrisma as db } from '@esgcredit/db-esg';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const tenderId = parseInt(params.id);

    if (isNaN(tenderId)) {
      return NextResponse.json(
        { error: 'Invalid tender ID' },
        { status: 400 }
      );
    }

    const tender = await db.tenders.findUnique({
      where: { id: tenderId },
      include: {
        tender_sources: {
          select: {
            name: true,
            short_name: true,
            country: true,
          },
        },
        tender_classifications: {
          select: {
            esg_score: true,
            credit_score: true,
            primary_domain: true,
            reasoning: true,
            esg_keywords: true,
            credit_keywords: true,
          },
        },
        tender_translations: {
          select: {
            source_language: true,
            target_language: true,
            translation_cost: true,
            translation_time_ms: true,
            created_at: true,
          },
        },
      },
    });

    if (!tender) {
      return NextResponse.json(
        { error: 'Tender not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: tender,
    });

  } catch (error) {
    console.error('[API] Tender detail error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch tender',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
