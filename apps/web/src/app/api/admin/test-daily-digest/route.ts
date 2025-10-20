import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin endpoint to test daily digest
 * Sends today's liked articles for a user's team
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    // Check if user is authenticated
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Get user info from session email
    const user = await esgPrisma.users.findUnique({
      where: { email: session.user.email },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        team: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.team) {
      return NextResponse.json({ error: "User has no team" }, { status: 400 });
    }

    // Get all team-liked content from today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const likedContent = await getTeamLikedContent(user.team, ['esg', 'credit'], todayStart);

    // Build user name
    const userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'User';

    // Queue test email
    await queueEmail({
      userId: user.id,
      to: user.email,
      subject: `Test Daily Digest - ${new Date().toLocaleDateString()}`,
      type: "daily_digest",
      alertType: 'daily_digest',
      domain: 'esg',
      data: {
        userName,
        alertName: "Test Daily Digest",
        content: likedContent,
        count: likedContent.length,
        period: "today",
      },
    });

    return NextResponse.json({
      ok: true,
      message: `Daily digest test email queued for ${user.email}`,
      results: {
        userId: user.id,
        userEmail: user.email,
        userName,
        team: user.team,
        likedArticles: likedContent.length,
        articles: likedContent.map(c => ({
          domain: c.domain,
          id: c.id,
          title: c.title,
          source: c.source,
          publishedDate: c.published_date,
          link: c.link,
        })),
      },
    });
  } catch (error: any) {
    console.error("Error testing daily digest:", error);
    return NextResponse.json(
      { error: error.message || "Failed to test daily digest" },
      { status: 500 }
    );
  }
}

async function getTeamLikedContent(team: string, domains: string[], since: Date) {
  const content: any[] = [];

  // First, get all user IDs in the team from ESG database (all users are stored there)
  let teamUserIds: number[] = [];
  try {
    const teamUsers = await esgPrisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM users WHERE team = ${team}
    `;
    teamUserIds = teamUsers.map(u => u.id);
    console.log(`Found ${teamUserIds.length} users in team "${team}": [${teamUserIds.join(', ')}]`);
  } catch (error) {
    console.error('Error getting team users:', error);
    return content;
  }

  if (teamUserIds.length === 0) {
    console.log(`No users found for team: ${team}`);
    return content;
  }

  for (const domain of domains) {
    // Get liked articles from correct database
    const prisma = domain === "esg" ? esgPrisma : creditPrisma;
    const tableName = domain === "esg" ? "esg_articles" : "credit_articles";
    const dateColumn = domain === "esg" ? "published" : "date";
    
    try {
      // Query articles liked by any user in the team
      // Note: likes table exists in both databases
      const articles = await prisma.$queryRawUnsafe<any[]>(`
        SELECT DISTINCT a.id, a.title, a.summary, a.source, a.${dateColumn} as published_date, a.link, l.created_at as liked_at
        FROM ${tableName} a
        JOIN likes l ON l.content_id = a.id AND l.content_type = 'article'
        WHERE l.user_id = ANY($1) AND l.created_at >= $2
        ORDER BY l.created_at DESC
        LIMIT 50
      `, teamUserIds, since);

      console.log(`Found ${articles.length} liked articles in ${domain} domain for team "${team}"`);
      content.push(...articles.map(a => ({ ...a, type: "article", domain })));
    } catch (error) {
      console.error(`Error querying ${tableName}:`, error);
    }
  }

  return content;
}

async function queueEmail(emailData: any) {
  try {
    // Build text body
    let textBody = `${emailData.subject}\n\nHello ${emailData.data.userName},\n\n`;
    textBody += `You have ${emailData.data.count} team-liked ${emailData.data.count === 1 ? 'article' : 'articles'} from ${emailData.data.period}:\n\n`;
    
    if (emailData.data.content && emailData.data.content.length > 0) {
      emailData.data.content.forEach((item: any, index: number) => {
        textBody += `${index + 1}. ${item.title}\n`;
        if (item.published_date) {
          textBody += `   Date: ${new Date(item.published_date).toLocaleDateString()}\n`;
        }
        if (item.domain) {
          textBody += `   Domain: ${item.domain.toUpperCase()}\n`;
        }
        textBody += `   Link: ${item.link}\n\n`;
      });
    } else {
      textBody += `No articles were liked by your team ${emailData.data.period}.\n`;
    }
    
    // Build HTML body
    let htmlBody = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #2c3e50;">${emailData.subject}</h2>
          <p>Hello ${emailData.data.userName},</p>
          <p>You have <strong>${emailData.data.count} team-liked ${emailData.data.count === 1 ? 'article' : 'articles'}</strong> from ${emailData.data.period}:</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
    `;
    
    if (emailData.data.content && emailData.data.content.length > 0) {
      emailData.data.content.forEach((item: any) => {
        const borderColor = item.domain === 'esg' ? '#27ae60' : '#e74c3c';
        const domainBadge = item.domain === 'esg' 
          ? '<span style="background: #27ae60; color: white; padding: 3px 8px; border-radius: 3px; font-size: 12px; font-weight: bold;">ESG</span>'
          : '<span style="background: #e74c3c; color: white; padding: 3px 8px; border-radius: 3px; font-size: 12px; font-weight: bold;">CREDIT</span>';
        
        htmlBody += `
          <div style="margin-bottom: 25px; padding: 15px; background: #f9f9f9; border-left: 4px solid ${borderColor};">
            <div style="margin-bottom: 8px;">${domainBadge}</div>
            <h3 style="margin-top: 0; color: #2c3e50;">
              <a href="${item.link}" style="color: #3498db; text-decoration: none;">${item.title}</a>
            </h3>
            ${item.published_date ? `<p style="color: #7f8c8d; font-size: 14px; margin: 5px 0;">📅 ${new Date(item.published_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>` : ''}
            ${item.source ? `<p style="color: #7f8c8d; font-size: 14px; margin: 5px 0;">📰 Source: ${item.source}</p>` : ''}
            <p style="margin-top: 10px;">
              <a href="${item.link}" style="display: inline-block; padding: 8px 15px; background: #3498db; color: white; text-decoration: none; border-radius: 4px;">Read More</a>
            </p>
          </div>
        `;
      });
    } else {
      htmlBody += `
        <div style="padding: 20px; background: #f9f9f9; border-radius: 5px; text-align: center;">
          <p style="color: #7f8c8d; margin: 0;">☕ No articles were liked by your team ${emailData.data.period}.</p>
        </div>
      `;
    }
    
    htmlBody += `
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #7f8c8d; font-size: 12px;">This is a test email from your ESG Portal Daily Digest system.</p>
        </body>
      </html>
    `;
    
    // Queue the email
    await esgPrisma.email_queue.create({
      data: {
        email_to: emailData.to,
        email_subject: emailData.subject,
        email_body: textBody,
        email_html: htmlBody,
        scheduled_for: new Date(),
        status: 'queued',
        alert_type: emailData.alertType || null,
        domain: emailData.domain || null,
        metadata: emailData,
        users: {
          connect: { id: emailData.userId }
        }
      }
    });
  } catch (error) {
    console.error("Error queuing email:", error);
    throw error;
  }
}
