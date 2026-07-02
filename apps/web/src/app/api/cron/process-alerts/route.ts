import { NextResponse } from "next/server";
import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";
import { requireCronSecret } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron job to process and send alerts based on their schedule
 * Enhanced with cross-database duplicate prevention using alert_content_sent table
 * 
 * This endpoint should be called periodically (e.g., every hour) by a cron job
 * It will:
 * 1. Find all active alerts that are due to be sent
 * 2. Generate appropriate content based on alert type and filters
 * 3. Send emails to users
 * 4. Update last_sent_at and next_send_at timestamps
 * 
 * Alert Types:
 * - weekly_digest: Sends every Monday at 9 AM (configurable)
 * - daily_digest: Sends every day at 9 AM (configurable)
 * - immediate_alerts: Sends when new content matches filters (check every hour)
 */
export async function GET(req: Request) {
  try {
    const authError = requireCronSecret(req);
    if (authError) return authError;

    const now = new Date();
    const results = {
      weekly_digests_sent: 0,
      daily_digests_sent: 0,
      immediate_alerts_sent: 0,
      errors: [] as string[],
    };

    // 1. Process Weekly Digests (send on specific day/hour)
    await processWeeklyDigests(now, results);

    // 2. Process Daily Digests (send daily at specific hour)
    await processDailyDigests(now, results);

    // 3. Process Immediate Alerts (check for new content)
    await processImmediateAlerts(now, results);

    const dubaiTime = now.toLocaleString('en-US', { timeZone: 'Asia/Dubai', hour12: false });
    
    return NextResponse.json({
      ok: true,
      message: "Alert processing completed",
      timestamp: dubaiTime,
      sent: {
        weekly: results.weekly_digests_sent,
        daily: results.daily_digests_sent, 
        immediate: results.immediate_alerts_sent
      },
      errors: results.errors.length
    });
  } catch (error: any) {
    console.error("Error processing alerts:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to process alerts" },
      { status: 500 }
    );
  }
}

async function processWeeklyDigests(now: Date, results: any) {
  try {
    // Get all weekly digests that are active
    const weeklyAlerts = await esgPrisma.$queryRaw<any[]>`
      SELECT ap.*, u.email, u.first_name, u.last_name, u.team
      FROM alert_preferences ap
      JOIN users u ON ap.user_id = u.id
      WHERE ap.alert_type = 'weekly_digest'
        AND ap.is_active = true
        AND ap.email_enabled = true
        AND (ap.last_sent_at IS NULL OR ap.last_sent_at < NOW() - INTERVAL '6 days')
    `;

    // Check each alert with its specific timezone
    for (const alert of weeklyAlerts) {
      try {
        // Convert current UTC time to alert's timezone
        const timezone = alert.timezone || 'Asia/Dubai';
        const currentTimeInTz = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        const currentDay = currentTimeInTz.toLocaleDateString("en-US", { weekday: "long", timeZone: timezone }).toLowerCase();
        const currentHour = currentTimeInTz.getHours();

        // Check if it's the right day and hour for this alert
        const alertDay = (alert.digest_day || 'monday').toLowerCase();
        const alertHour = alert.digest_hour || 9;

        if (currentDay !== alertDay || currentHour !== alertHour) {
          continue; // Skip this alert, not the right time yet
        }

        await sendWeeklyDigest(alert);
        
        // Update last_sent_at and next_send_at
        await esgPrisma.$executeRaw`
          UPDATE alert_preferences
          SET last_sent_at = NOW(),
              next_send_at = NOW() + INTERVAL '7 days'
          WHERE id = ${alert.id}
        `;
        
        results.weekly_digests_sent++;
      } catch (error: any) {
        results.errors.push(`Weekly digest error for alert ${alert.id}: ${error.message}`);
      }
    }
  } catch (error: any) {
    results.errors.push(`Weekly digest processing error: ${error.message}`);
  }
}

async function processDailyDigests(now: Date, results: any) {
  try {
    // Get all daily digests that are active
    const dailyAlerts = await esgPrisma.$queryRaw<any[]>`
      SELECT ap.*, u.email, u.first_name, u.last_name, u.team
      FROM alert_preferences ap
      JOIN users u ON ap.user_id = u.id
      WHERE ap.alert_type = 'daily_digest'
        AND ap.is_active = true
        AND ap.email_enabled = true
        AND (ap.last_sent_at IS NULL OR ap.last_sent_at < NOW() - INTERVAL '20 hours')
    `;

    // Check each alert with its specific timezone
    for (const alert of dailyAlerts) {
      try {
        // Convert current UTC time to alert's timezone
        const timezone = alert.timezone || 'Asia/Dubai';
        const currentTimeInTz = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        const currentHour = currentTimeInTz.getHours();

        // Check if it's the right hour for this alert
        const alertHour = alert.digest_hour || 9;

        if (currentHour !== alertHour) {
          continue; // Skip this alert, not the right time yet
        }

        await sendDailyDigest(alert);
        
        // Update last_sent_at and next_send_at
        await esgPrisma.$executeRaw`
          UPDATE alert_preferences
          SET last_sent_at = NOW(),
              next_send_at = NOW() + INTERVAL '1 day'
          WHERE id = ${alert.id}
        `;
        
        results.daily_digests_sent++;
      } catch (error: any) {
        results.errors.push(`Daily digest error for alert ${alert.id}: ${error.message}`);
      }
    }
  } catch (error: any) {
    results.errors.push(`Daily digest processing error: ${error.message}`);
  }
}

async function processImmediateAlerts(now: Date, results: any) {
  try {
    // Find immediate alerts that are active
    const immediateAlerts = await esgPrisma.$queryRaw<any[]>`
      SELECT ap.*, u.email, u.first_name, u.last_name, u.team
      FROM alert_preferences ap
      JOIN users u ON ap.user_id = u.id
      WHERE ap.alert_type = 'immediate_alerts'
        AND ap.is_active = true
        AND ap.email_enabled = true
    `;

    for (const alert of immediateAlerts) {
      try {
        // Check for new content since last check (default: last 30 minutes)
        // Using 30 minutes lookback to catch content that might have been missed
        const lastCheck = alert.last_sent_at || new Date(now.getTime() - 30 * 60 * 1000);
        
        // Get already sent content IDs to filter out duplicates
        const sentContent = await getAlreadySentContent(alert.id);
        
        // Find new content from BOTH databases, excluding already-sent items
        const newContent = await findNewContentForAlert(alert, lastCheck, sentContent);

        if (newContent.length > 0) {
          await sendImmediateAlert(alert, newContent);
          
          // Track sent content to prevent future duplicates
          await trackSentContent(alert.id, newContent);
          
          // Update last_sent_at
          await esgPrisma.$executeRaw`
            UPDATE alert_preferences
            SET last_sent_at = NOW()
            WHERE id = ${alert.id}
          `;
          
          results.immediate_alerts_sent++;
        }
      } catch (error: any) {
        results.errors.push(`Immediate alert error for alert ${alert.id}: ${error.message}`);
      }
    }
  } catch (error: any) {
    results.errors.push(`Immediate alert processing error: ${error.message}`);
  }
}

/**
 * Get already sent content for this alert to prevent duplicates
 */
async function getAlreadySentContent(alertPreferenceId: number): Promise<Set<string>> {
  try {
    const sentContent = await esgPrisma.$queryRaw<any[]>`
      SELECT domain, content_type, content_id
      FROM alert_content_sent
      WHERE alert_preference_id = ${alertPreferenceId}
        AND sent_at > NOW() - INTERVAL '7 days'
    `;

    // Create a Set of unique keys for fast lookup: "esg:article:123"
    return new Set(
      sentContent.map((c: any) => `${c.domain}:${c.content_type}:${c.content_id}`)
    );
  } catch (error) {
    console.error("Error fetching already sent content:", error);
    return new Set();
  }
}

/**
 * Track sent content to prevent future duplicates
 */
async function trackSentContent(alertPreferenceId: number, content: any[]) {
  try {
    // Insert each content item into tracking table
    for (const item of content) {
      try {
        await esgPrisma.$executeRaw`
          INSERT INTO alert_content_sent (
            alert_preference_id, domain, content_type, content_id, content_save_time, sent_at
          ) VALUES (
            ${alertPreferenceId},
            ${item.domain},
            ${item.type},
            ${item.id},
            ${item.save_time || null},
            NOW()
          )
          ON CONFLICT (alert_preference_id, domain, content_type, content_id) 
          DO NOTHING
        `;
      } catch (error) {
        // Ignore duplicate key errors, continue with next item
        console.error(`Error tracking content ${item.domain}:${item.type}:${item.id}:`, error);
      }
    }
  } catch (error) {
    console.error("Error tracking sent content:", error);
    // Don't throw - tracking failure shouldn't stop alert sending
  }
}

async function findNewContentForAlert(alert: any, since: Date, alreadySent: Set<string>) {
  const newContent: any[] = [];
  const domains = alert.domains || [alert.domain];
  const keywords = alert.immediate_keywords || [];
  const sources = alert.immediate_sources || [];

  // save_time is stored as UTC with timezone (+00), so we use 'since' directly
  // No timezone conversion needed - PostgreSQL handles the comparison correctly

  // Build keyword search pattern
  const keywordPattern = keywords.length > 0 
    ? keywords.map((k: string) => `%${k.toLowerCase()}%`).join("|")
    : null;

  // Check articles for each domain (ONLY ARTICLES)
  for (const domain of domains) {
    const prisma = domain === "esg" ? esgPrisma : creditPrisma;
    const tableName = domain === "esg" ? "esg_articles" : "credit_articles";
    // ESG DB: published column, Credit DB: date column
    const publishedDateColumn = domain === "esg" ? "published" : "date";
    
    try {
      // Only send articles published TODAY
      // Get start of today in UTC (00:00:00)
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      
      let query = `
        SELECT id, title, summary, source, ${publishedDateColumn} as published_date, link, save_time
        FROM ${tableName}
        WHERE save_time > $1
          AND ${publishedDateColumn}::date = CURRENT_DATE
      `;
      const params: any[] = [since];

      if (sources.length > 0) {
        query += ` AND source = ANY($${params.length + 1})`;
        params.push(sources);
      }

      if (keywordPattern) {
        query += ` AND (LOWER(title) SIMILAR TO $${params.length + 1} OR LOWER(summary) SIMILAR TO $${params.length + 1})`;
        params.push(keywordPattern);
      }

      query += ` ORDER BY save_time DESC LIMIT 20`;

      const articles = await prisma.$queryRawUnsafe<any[]>(query, ...params);
      
      // Filter out already-sent articles
      const newArticles = articles.filter((a: any) => 
        !alreadySent.has(`${domain}:article:${a.id}`)
      );
      
      newContent.push(...newArticles.map(a => ({ ...a, type: "article", domain })));
    } catch (error) {
      console.error(`Error querying ${tableName}:`, error);
    }
  }

  return newContent;
}

async function sendWeeklyDigest(alert: any) {
  // Get all team-liked content from the past week
  const domains = alert.domains || [alert.domain];
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const likedContent = await getTeamLikedContent(alert.team, domains, oneWeekAgo);

  // Build user name from first_name and last_name
  const userName = [alert.first_name, alert.last_name].filter(Boolean).join(' ') || 'User';

  // Queue email
  await queueEmail({
    userId: alert.user_id,
    to: alert.email_address || alert.email,
    subject: `${alert.alert_name} - Weekly Digest`,
    type: "weekly_digest",
    alertType: 'weekly_digest',
    domain: alert.domain || alert.domains?.[0] || 'esg',
    data: {
      userName,
      alertName: alert.alert_name,
      content: likedContent,
      count: likedContent.length, // FIX: Add count
      period: "past week",
    },
  });
}

async function sendDailyDigest(alert: any) {
  // Get all team-liked content from the past day
  const domains = alert.domains || [alert.domain];
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const likedContent = await getTeamLikedContent(alert.team, domains, oneDayAgo);

  // Build user name from first_name and last_name
  const userName = [alert.first_name, alert.last_name].filter(Boolean).join(' ') || 'User';

  // Queue email
  await queueEmail({
    userId: alert.user_id,
    to: alert.email_address || alert.email,
    subject: `${alert.alert_name} - Daily Digest`,
    type: "daily_digest",
    alertType: 'daily_digest',
    domain: alert.domain || alert.domains?.[0] || 'esg',
    data: {
      userName,
      alertName: alert.alert_name,
      content: likedContent,
      count: likedContent.length, // FIX: Add count
      period: "past day",
    },
  });
}

async function sendImmediateAlert(alert: any, newContent: any[]) {
  // Build user name from first_name and last_name
  const userName = [alert.first_name, alert.last_name].filter(Boolean).join(' ') || 'User';

  // Queue email with new content
  await queueEmail({
    userId: alert.user_id,
    to: alert.email_address || alert.email,
    subject: `${alert.alert_name} - New Content Alert`,
    type: "immediate_alert",
    alertType: 'immediate_alert',
    domain: alert.domain || alert.domains?.[0] || 'esg',
    data: {
      userName,
      alertName: alert.alert_name,
      content: newContent,
      count: newContent.length,
    },
  });
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
  } catch (error) {
    console.error('Error getting team users:', error);
    return content;
  }

  if (teamUserIds.length === 0) {
    return content;
  }

  for (const domain of domains) {
    // Get liked articles from correct database
    const prisma = domain === "esg" ? esgPrisma : creditPrisma;
    const tableName = domain === "esg" ? "esg_articles" : "credit_articles";
    const dateColumn = domain === "esg" ? "published" : "date"; // Different column names!
    
    try {
      // Query articles liked by any user in the team
      // Note: likes table exists in both databases, but users table only in ESG
      const articles = await prisma.$queryRawUnsafe<any[]>(`
        SELECT DISTINCT a.id, a.title, a.summary, a.source, a.${dateColumn} as published_date, a.link, l.created_at as liked_at
        FROM ${tableName} a
        JOIN likes l ON l.content_id = a.id AND l.content_type = 'article'
        WHERE l.user_id = ANY($1) AND l.created_at > $2
        ORDER BY l.created_at DESC
        LIMIT 50
      `, teamUserIds, since);
      content.push(...articles.map(a => ({ ...a, type: "article", domain })));
    } catch (error) {
      console.error(`Error fetching liked articles from ${tableName}:`, error);
    }
  }

  // Get liked events
  try {
    const events = await esgPrisma.$queryRawUnsafe<any[]>(`
      SELECT DISTINCT e.id, e.title, e.description as summary, e.source, e.event_date, e.link, l.created_at as liked_at
      FROM events e
      JOIN likes l ON l.content_id = e.id AND l.content_type = 'event'
      WHERE l.user_id = ANY($1) AND l.created_at > $2
      ORDER BY l.created_at DESC
      LIMIT 50
    `, teamUserIds, since);
    content.push(...events.map(e => ({ ...e, type: "event" })));
  } catch (error) {
    console.error("Error fetching liked events:", error);
  }

  // Get liked publications
  try {
    const publications = await esgPrisma.$queryRawUnsafe<any[]>(`
      SELECT DISTINCT p.id, p.title, p.summary, p.source, p.published_date, p.link, l.created_at as liked_at
      FROM publications p
      JOIN likes l ON l.content_id = p.id AND l.content_type = 'publication'
      WHERE l.user_id = ANY($1) AND l.created_at > $2
      ORDER BY l.created_at DESC
      LIMIT 50
    `, teamUserIds, since);
    content.push(...publications.map(p => ({ ...p, type: "publication" })));
  } catch (error) {
    console.error("Error fetching liked publications:", error);
  }

  return content;
}

async function queueEmail(emailData: any) {
  try {
    // Build text body with content details
    let textBody = `${emailData.subject}\n\nHello ${emailData.data.userName},\n\n`;
    textBody += `You have ${emailData.data.count} new items:\n\n`;
    
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
    }
    
    // Build HTML body with content details
    let htmlBody = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #2c3e50;">${emailData.subject}</h2>
          <p>Hello ${emailData.data.userName},</p>
          <p>You have <strong>${emailData.data.count} new items</strong> from your alert <strong>${emailData.data.alertName}</strong>:</p>
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
    }
    
    htmlBody += `
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #7f8c8d; font-size: 12px;">This is an automated alert from your ESG Portal. You can manage your alerts in your profile settings.</p>
        </body>
      </html>
    `;
    
    // Use Prisma client to insert, which will handle all defaults properly
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
