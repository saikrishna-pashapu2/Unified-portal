import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/nextauth-options';
import { esgPrisma } from '@esgcredit/db-esg';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ isAdmin: false }, { status: 401 });
    }

    // Check if user is admin
    const user = await esgPrisma.users.findUnique({
      where: { email: session.user.email },
      select: { is_admin: true },
    });

    return NextResponse.json({ isAdmin: user?.is_admin || false });
  } catch (error) {
    console.error('Error checking admin access:', error);
    return NextResponse.json({ isAdmin: false }, { status: 500 });
  }
}
