/**
 * API Route: Save/Unsave Tender
 * POST /api/tenders/save
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/nextauth-options';
import { esgPrisma as db } from '@esgcredit/db-esg';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session || !session.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { tenderId } = await request.json();

    if (!tenderId) {
      return NextResponse.json(
        { success: false, error: 'Tender ID is required' },
        { status: 400 }
      );
    }

    // Get user
    const user = await db.users.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // Check if already saved
    const existing = await db.user_saved_tenders.findFirst({
      where: {
        user_id: user.id,
        tender_id: tenderId,
      },
    });

    if (existing) {
      // Unsave
      await db.user_saved_tenders.delete({
        where: {
          id: existing.id,
        },
      });

      return NextResponse.json({
        success: true,
        saved: false,
      });
    } else {
      // Save
      await db.user_saved_tenders.create({
        data: {
          user_id: user.id,
          tender_id: tenderId,
        },
      });

      return NextResponse.json({
        success: true,
        saved: true,
      });
    }
  } catch (error) {
    console.error('Error saving tender:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
