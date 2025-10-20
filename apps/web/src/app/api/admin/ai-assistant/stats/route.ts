// API Route: AI Assistant Statistics for Admin Dashboard
// GET /api/admin/ai-assistant/stats

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/nextauth-options';
import { esgPrisma } from '@esgcredit/db-esg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // Authentication check
    const authSession = await getServerSession(authOptions);
    if (!authSession?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get user and check admin role
    const user = await esgPrisma.users.findUnique({
      where: { email: authSession.user.email },
      select: {
        id: true,
        is_admin: true,
      },
    });

    if (!user || !user.is_admin) {
      return NextResponse.json(
        { success: false, error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    // Get query parameters for date filtering
    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get('days') || '30');
    const domain = searchParams.get('domain') || 'all'; // 'all', 'credit', 'esg'

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Build where clause
    const whereClause: any = {
      created_at: {
        gte: startDate,
      },
    };

    if (domain !== 'all') {
      whereClause.domain = domain;
    }

    // ============================================================
    // FETCH REAL DATA FROM article_conversations and article_messages
    // ============================================================

    // Total conversations in period
    const totalSessionsQuery = domain !== 'all' 
      ? esgPrisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint as count
          FROM article_conversations
          WHERE created_at >= ${startDate}
          AND article_source = ${domain}
        `
      : esgPrisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint as count
          FROM article_conversations
          WHERE created_at >= ${startDate}
        `;
    
    const totalSessions = await totalSessionsQuery.then(result => Number(result[0]?.count || 0));

    // Active sessions (with messages in last 24 hours)
    const last24Hours = new Date();
    last24Hours.setHours(last24Hours.getHours() - 24);
    
    const activeSessionsQuery = domain !== 'all'
      ? esgPrisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(DISTINCT ac.id)::bigint as count
          FROM article_conversations ac
          WHERE ac.last_message_at >= ${last24Hours}
          AND ac.article_source = ${domain}
        `
      : esgPrisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(DISTINCT ac.id)::bigint as count
          FROM article_conversations ac
          WHERE ac.last_message_at >= ${last24Hours}
        `;
    
    const activeSessions = await activeSessionsQuery.then(result => Number(result[0]?.count || 0));

    // Total messages
    const totalMessagesQuery = domain !== 'all'
      ? esgPrisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint as count
          FROM article_messages am
          JOIN article_conversations ac ON am.conversation_id = ac.id
          WHERE am.created_at >= ${startDate}
          AND ac.article_source = ${domain}
        `
      : esgPrisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint as count
          FROM article_messages am
          JOIN article_conversations ac ON am.conversation_id = ac.id
          WHERE am.created_at >= ${startDate}
        `;
    
    const totalMessages = await totalMessagesQuery.then(result => Number(result[0]?.count || 0));

    // Unique users
    const uniqueUsersQuery = domain !== 'all'
      ? esgPrisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(DISTINCT user_id)::bigint as count
          FROM article_conversations
          WHERE created_at >= ${startDate}
          AND user_id IS NOT NULL
          AND article_source = ${domain}
        `
      : esgPrisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(DISTINCT user_id)::bigint as count
          FROM article_conversations
          WHERE created_at >= ${startDate}
          AND user_id IS NOT NULL
        `;
    
    const uniqueUsers = await uniqueUsersQuery.then(result => Number(result[0]?.count || 0));

    // Total tokens and cost
    const tokenStatsQuery = domain !== 'all'
      ? esgPrisma.$queryRaw<Array<{ total_tokens: bigint; total_cost: number }>>`
          SELECT 
            COALESCE(SUM(total_tokens_used), 0)::bigint as total_tokens,
            COALESCE(SUM(total_cost_usd), 0) as total_cost
          FROM article_conversations
          WHERE created_at >= ${startDate}
          AND article_source = ${domain}
        `
      : esgPrisma.$queryRaw<Array<{ total_tokens: bigint; total_cost: number }>>`
          SELECT 
            COALESCE(SUM(total_tokens_used), 0)::bigint as total_tokens,
            COALESCE(SUM(total_cost_usd), 0) as total_cost
          FROM article_conversations
          WHERE created_at >= ${startDate}
        `;
    
    const tokenStats = await tokenStatsQuery;
    
    const totalTokens = Number(tokenStats[0]?.total_tokens || 0);
    const totalCost = Number(tokenStats[0]?.total_cost || 0);

    // Domain stats
    const domainStatsRaw = await esgPrisma.$queryRaw<Array<{ 
      domain: string; 
      sessions: bigint; 
      messages: bigint; 
      tokens: bigint; 
      cost: number;
    }>>`
      SELECT 
        ac.article_source as domain,
        COUNT(DISTINCT ac.id)::bigint as sessions,
        COUNT(am.id)::bigint as messages,
        COALESCE(SUM(ac.total_tokens_used), 0)::bigint as tokens,
        COALESCE(SUM(ac.total_cost_usd), 0) as cost
      FROM article_conversations ac
      LEFT JOIN article_messages am ON am.conversation_id = ac.id
      WHERE ac.created_at >= ${startDate}
      GROUP BY ac.article_source
      ORDER BY sessions DESC
    `;

    const domainStats = domainStatsRaw.map(stat => ({
      domain: stat.domain,
      sessions: Number(stat.sessions),
      messages: Number(stat.messages),
      tokens: Number(stat.tokens),
      cost: Number(stat.cost),
    }));

    // Daily trend (last 7 days)
    const dailyTrendQuery = domain !== 'all'
      ? esgPrisma.$queryRaw<Array<{
          date: Date;
          sessions: bigint;
          messages: bigint;
        }>>`
          SELECT 
            DATE(ac.created_at) as date,
            COUNT(DISTINCT ac.id)::bigint as sessions,
            COUNT(am.id)::bigint as messages
          FROM article_conversations ac
          LEFT JOIN article_messages am ON am.conversation_id = ac.id
          WHERE ac.created_at >= ${startDate}
          AND ac.article_source = ${domain}
          GROUP BY DATE(ac.created_at)
          ORDER BY date DESC
          LIMIT 7
        `
      : esgPrisma.$queryRaw<Array<{
          date: Date;
          sessions: bigint;
          messages: bigint;
        }>>`
          SELECT 
            DATE(ac.created_at) as date,
            COUNT(DISTINCT ac.id)::bigint as sessions,
            COUNT(am.id)::bigint as messages
          FROM article_conversations ac
          LEFT JOIN article_messages am ON am.conversation_id = ac.id
          WHERE ac.created_at >= ${startDate}
          GROUP BY DATE(ac.created_at)
          ORDER BY date DESC
          LIMIT 7
        `;
    
    const dailyTrendRaw = await dailyTrendQuery;

    const dailyTrend = dailyTrendRaw.map(day => ({
      date: day.date,
      sessions: Number(day.sessions),
      messages: Number(day.messages),
    }));

    // Top users
    const topUsersQuery = domain !== 'all'
      ? esgPrisma.$queryRaw<Array<{
          user_id: number;
          sessions: bigint;
          messages: bigint;
          tokens: bigint;
        }>>`
          SELECT 
            ac.user_id,
            COUNT(DISTINCT ac.id)::bigint as sessions,
            COUNT(am.id)::bigint as messages,
            COALESCE(SUM(ac.total_tokens_used), 0)::bigint as tokens
          FROM article_conversations ac
          LEFT JOIN article_messages am ON am.conversation_id = ac.id
          WHERE ac.created_at >= ${startDate}
          AND ac.user_id IS NOT NULL
          AND ac.article_source = ${domain}
          GROUP BY ac.user_id
          ORDER BY sessions DESC
          LIMIT 10
        `
      : esgPrisma.$queryRaw<Array<{
          user_id: number;
          sessions: bigint;
          messages: bigint;
          tokens: bigint;
        }>>`
          SELECT 
            ac.user_id,
            COUNT(DISTINCT ac.id)::bigint as sessions,
            COUNT(am.id)::bigint as messages,
            COALESCE(SUM(ac.total_tokens_used), 0)::bigint as tokens
          FROM article_conversations ac
          LEFT JOIN article_messages am ON am.conversation_id = ac.id
          WHERE ac.created_at >= ${startDate}
          AND ac.user_id IS NOT NULL
          GROUP BY ac.user_id
          ORDER BY sessions DESC
          LIMIT 10
        `;
    
    const topUsersRaw = await topUsersQuery;

    // Get user details
    const topUsersWithDetails = await Promise.all(
      topUsersRaw.map(async (user) => {
        const userDetails = await esgPrisma.users.findUnique({
          where: { id: user.user_id },
          select: { id: true, email: true, first_name: true, last_name: true },
        });
        return {
          ...userDetails,
          sessions: Number(user.sessions),
          messages: Number(user.messages),
          tokens: Number(user.tokens),
        };
      })
    );

    // Top articles
    const topArticlesQuery = domain !== 'all'
      ? esgPrisma.$queryRaw<Array<{
          article_id: number;
          article_source: string;
          sessions: bigint;
          messages: bigint;
        }>>`
          SELECT 
            ac.article_id,
            ac.article_source,
            COUNT(DISTINCT ac.id)::bigint as sessions,
            COUNT(am.id)::bigint as messages
          FROM article_conversations ac
          LEFT JOIN article_messages am ON am.conversation_id = ac.id
          WHERE ac.created_at >= ${startDate}
          AND ac.article_source = ${domain}
          GROUP BY ac.article_id, ac.article_source
          ORDER BY sessions DESC
          LIMIT 10
        `
      : esgPrisma.$queryRaw<Array<{
          article_id: number;
          article_source: string;
          sessions: bigint;
          messages: bigint;
        }>>`
          SELECT 
            ac.article_id,
            ac.article_source,
            COUNT(DISTINCT ac.id)::bigint as sessions,
            COUNT(am.id)::bigint as messages
          FROM article_conversations ac
          LEFT JOIN article_messages am ON am.conversation_id = ac.id
          WHERE ac.created_at >= ${startDate}
          GROUP BY ac.article_id, ac.article_source
          ORDER BY sessions DESC
          LIMIT 10
        `;
    
    const topArticles = await topArticlesQuery.then(results => results.map(r => ({
      article_id: r.article_id,
      article_source: r.article_source,
      sessions: Number(r.sessions),
      messages: Number(r.messages),
    })));

    // Recent activity
    const recentActivityQuery = domain !== 'all'
      ? esgPrisma.$queryRaw<Array<{
          id: number;
          session_id: string;
          user_id: number | null;
          article_id: number;
          article_source: string;
          total_messages: number;
          created_at: Date;
          last_message_at: Date | null;
        }>>`
          SELECT 
            id,
            session_id,
            user_id,
            article_id,
            article_source,
            total_messages,
            created_at,
            last_message_at
          FROM article_conversations
          WHERE created_at >= ${startDate}
          AND article_source = ${domain}
          ORDER BY last_message_at DESC NULLS LAST
          LIMIT 20
        `
      : esgPrisma.$queryRaw<Array<{
          id: number;
          session_id: string;
          user_id: number | null;
          article_id: number;
          article_source: string;
          total_messages: number;
          created_at: Date;
          last_message_at: Date | null;
        }>>`
          SELECT 
            id,
            session_id,
            user_id,
            article_id,
            article_source,
            total_messages,
            created_at,
            last_message_at
          FROM article_conversations
          WHERE created_at >= ${startDate}
          ORDER BY last_message_at DESC NULLS LAST
          LIMIT 20
        `;
    
    const recentActivity = await recentActivityQuery;

    // Performance metrics
    const avgTokensPerSession = totalSessions > 0 ? Math.round(totalTokens / totalSessions) : 0;
    const avgCostPerSession = totalSessions > 0 ? (totalCost / totalSessions) : 0;
    const avgSessionsPerUser = uniqueUsers > 0 ? (totalSessions / uniqueUsers) : 0;

    // Get user details for recent activity
    const recentActivityWithUsers = await Promise.all(
      recentActivity.map(async (activity) => {
        const user = activity.user_id ? await esgPrisma.users.findUnique({
          where: { id: activity.user_id },
          select: { id: true, email: true, first_name: true, last_name: true },
        }) : null;
        
        return {
          sessionId: activity.session_id,
          articleId: activity.article_id,
          domain: activity.article_source,
          userId: activity.user_id || 0,
          userName: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown',
          userEmail: user?.email || 'N/A',
          createdAt: activity.created_at.toISOString(),
          messageCount: activity.total_messages,
          tokens: 0, // Not tracked per conversation yet
          cost: 0, // Not tracked per conversation yet
        };
      })
    );

    // ============================================================
    // RESPONSE
    // ============================================================
    return NextResponse.json({
      success: true,
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      overview: {
        totalSessions,
        activeSessions,
        totalMessages,
        uniqueUsers,
        totalTokens,
        totalCost,
        avgTokensPerSession,
        avgCostPerSession,
        avgSessionsPerUser,
      },
      domainBreakdown: domainStats.map(stat => ({
        domain: stat.domain,
        sessions: stat.sessions,
        tokens: stat.tokens,
        cost: stat.cost,
        messages: stat.messages,
      })),
      dailyTrend: dailyTrend.map(day => ({
        date: day.date.toISOString().split('T')[0],
        sessions: day.sessions,
        tokens: 0, // Not tracked in daily aggregation yet
        cost: 0, // Not tracked in daily aggregation yet
        messages: day.messages,
      })),
      topUsers: topUsersWithDetails.map(user => ({
        userId: user.id,
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown',
        email: user.email || 'N/A',
        sessions: user.sessions,
        tokens: user.tokens,
        cost: 0, // Cost not tracked yet
      })),
      topArticles: topArticles.map(article => ({
        articleId: article.article_id,
        domain: article.article_source,
        sessions: article.sessions,
        tokens: 0, // Not tracked per article yet
        messages: article.messages,
      })),
      recentActivity: recentActivityWithUsers,
    });
  } catch (error: any) {
    console.error('[Admin AI Stats] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch AI assistant statistics',
      },
      { status: 500 }
    );
  }
}
