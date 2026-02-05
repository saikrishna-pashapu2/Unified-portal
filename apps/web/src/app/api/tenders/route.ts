/**
 * API Route: Tenders List
 * GET /api/tenders?domain=esg&page=1&limit=20
 */

import { NextRequest, NextResponse } from 'next/server';
import { esgPrisma as db } from '@esgcredit/db-esg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    const domain = searchParams.get('domain'); // 'esg', 'credit', 'both'
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const search = searchParams.get('search');
    const status = searchParams.get('status');
    const minAmount = searchParams.get('minAmount');
    const maxAmount = searchParams.get('maxAmount');

    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      is_active: true,
    };

    // Domain filter
    if (domain && domain !== 'all') {
      if (domain === 'esg' || domain === 'credit') {
        where.primary_domain = {
          in: [domain, 'both'],
        };
      }
    }

    // Search filter
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { customer_name: { contains: search, mode: 'insensitive' } },
        { tender_number: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Status filter
    if (status) {
      where.status = status;
    }

    // Amount filters
    if (minAmount) {
      where.total_amount = { ...where.total_amount, gte: parseFloat(minAmount) };
    }
    if (maxAmount) {
      where.total_amount = { ...where.total_amount, lte: parseFloat(maxAmount) };
    }

    // Fetch tenders
    const [tenders, total] = await Promise.all([
      db.tenders.findMany({
        where,
        select: {
          id: true,
          tender_number: true,
          title: true,
          description: true,
          total_amount: true,
          currency: true,
          customer_name: true,
          application_end_date: true,
          published_date: true,
          status: true,
          primary_domain: true,
          domain_classification: true,
          tender_url: true,
          created_at: true,
        },
        orderBy: [
          // Prioritize "published" status tenders first
          {
            status: 'desc', // Published comes before other statuses alphabetically
          },
          // Then sort by published_date (latest to oldest)
          {
            published_date: 'desc',
          },
        ],
        skip,
        take: limit,
      }),
      db.tenders.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: tenders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });

  } catch (error) {
    console.error('[API] Tenders list error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch tenders',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
