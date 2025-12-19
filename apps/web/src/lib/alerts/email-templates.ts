/**
 * Email Templates for Alert System
 * Professional HTML email templates with responsive design
 */

import type { DigestData, DigestArticle } from "./digest";

const COLORS = {
  primary: "#10b981", // Emerald-500
  secondary: "#059669", // Emerald-600
  text: "#1f2937", // Gray-800
  textLight: "#6b7280", // Gray-500
  background: "#f9fafb", // Gray-50
  white: "#ffffff",
  border: "#e5e7eb", // Gray-200
  esg: "#10b981", // Emerald
  credit: "#3b82f6", // Blue
};

/**
 * Base email template wrapper
 */
function emailWrapper(content: string, domain: "esg" | "credit"): string {
  const brandColor = domain === "esg" ? COLORS.esg : COLORS.credit;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alert Email</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: ${COLORS.background};
      color: ${COLORS.text};
      line-height: 1.6;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: ${COLORS.white};
    }
    .header {
      background: linear-gradient(135deg, ${brandColor} 0%, ${COLORS.secondary} 100%);
      padding: 40px 20px;
      text-align: center;
      color: ${COLORS.white};
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 700;
    }
    .header p {
      margin: 10px 0 0 0;
      font-size: 14px;
      opacity: 0.9;
    }
    .content {
      padding: 40px 30px;
    }
    .greeting {
      font-size: 18px;
      margin-bottom: 20px;
      color: ${COLORS.text};
    }
    .article-card {
      background: ${COLORS.background};
      border-left: 4px solid ${brandColor};
      padding: 20px;
      margin-bottom: 20px;
      border-radius: 8px;
      transition: transform 0.2s;
    }
    .article-title {
      font-size: 18px;
      font-weight: 600;
      color: ${COLORS.text};
      margin: 0 0 10px 0;
      line-height: 1.4;
    }
    .article-meta {
      font-size: 14px;
      color: ${COLORS.textLight};
      margin-bottom: 10px;
    }
    .article-meta span {
      margin-right: 15px;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      background-color: ${brandColor};
      color: ${COLORS.white};
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      margin-right: 8px;
    }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      background-color: ${brandColor};
      color: ${COLORS.white};
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      margin-top: 10px;
    }
    .btn:hover {
      opacity: 0.9;
    }
    .stats-row {
      display: flex;
      gap: 20px;
      margin: 20px 0;
      flex-wrap: wrap;
    }
    .stat-box {
      flex: 1;
      min-width: 150px;
      background: ${COLORS.background};
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-number {
      font-size: 32px;
      font-weight: 700;
      color: ${brandColor};
      margin: 0;
    }
    .stat-label {
      font-size: 14px;
      color: ${COLORS.textLight};
      margin-top: 5px;
    }
    .footer {
      background-color: ${COLORS.background};
      padding: 30px;
      text-align: center;
      font-size: 13px;
      color: ${COLORS.textLight};
      border-top: 1px solid ${COLORS.border};
    }
    .footer a {
      color: ${brandColor};
      text-decoration: none;
    }
    .divider {
      height: 1px;
      background-color: ${COLORS.border};
      margin: 30px 0;
    }
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: ${COLORS.textLight};
    }
    @media only screen and (max-width: 600px) {
      .content {
        padding: 20px 15px;
      }
      .header h1 {
        font-size: 24px;
      }
      .stats-row {
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    ${content}
    <div class="footer">
      <p>You're receiving this email because you subscribed to ${domain === 'esg' ? 'ESG' : 'CREDIT RATING'} alerts.</p>
      <p>
        <a href="{{PREFERENCES_URL}}">Manage Preferences</a> |
        <a href="{{UNSUBSCRIBE_URL}}">Unsubscribe</a>
      </p>
      <p style="margin-top: 20px; font-size: 12px;">
        © 2025 ESG Credit Rating. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Format article card HTML
 */
function renderArticleCard(
  article: DigestArticle,
  showLikes = false
): string {
  const title = article.title || "Untitled Article";
  const source = article.source || "Unknown Source";
  const link = article.link || "#";
  const date = article.date
    ? new Date(article.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const likes = article.likes || 0;

  return `
    <div class="article-card">
      <h3 class="article-title">${escapeHtml(title)}</h3>
      <div class="article-meta">
        <span>📰 ${escapeHtml(source)}</span>
        ${date ? `<span>📅 ${date}</span>` : ""}
        ${showLikes && likes > 0 ? `<span class="badge">❤️ ${likes} ${likes === 1 ? "like" : "likes"}</span>` : ""}
      </div>
      <a href="${link}" class="btn">Read Article →</a>
    </div>
  `;
}

/**
 * Weekly Digest Template
 */
export function generateWeeklyDigestHTML(
  user: any,
  digest: DigestData,
  domain: "esg" | "credit"
): string {
  const userName = user.first_name || user.username || "User";
  const domainUpper = domain.toUpperCase();

  let contentHtml = `
    <div class="header">
      <h1>📬 Weekly Digest</h1>
      <p>${domainUpper} Portal • ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
    </div>
    <div class="content">
      <p class="greeting">Hi ${escapeHtml(userName)},</p>
      <p>Here's what your team has been reading this week! We've gathered the top articles, events, and publications that your colleagues found most valuable.</p>
  `;

  // Stats row
  contentHtml += `
    <div class="stats-row">
      <div class="stat-box">
        <div class="stat-number">${digest.articles.length}</div>
        <div class="stat-label">Articles</div>
      </div>
      <div class="stat-box">
        <div class="stat-number">${digest.events.length}</div>
        <div class="stat-label">Events</div>
      </div>
      <div class="stat-box">
        <div class="stat-number">${digest.publications.length}</div>
        <div class="stat-label">Publications</div>
      </div>
    </div>
  `;

  // Articles section
  if (digest.articles.length > 0) {
    contentHtml += `
      <div class="divider"></div>
      <h2 style="color: ${domain === "esg" ? COLORS.esg : COLORS.credit}; margin-bottom: 20px;">
        🔥 Trending Articles
      </h2>
    `;
    digest.articles.forEach((article) => {
      contentHtml += renderArticleCard(article, true);
    });
  }

  // Events section
  if (digest.events.length > 0) {
    contentHtml += `
      <div class="divider"></div>
      <h2 style="color: ${domain === "esg" ? COLORS.esg : COLORS.credit}; margin-bottom: 20px;">
        📅 Upcoming Events
      </h2>
    `;
    digest.events.slice(0, 5).forEach((event: any) => {
      contentHtml += `
        <div class="article-card">
          <h3 class="article-title">${escapeHtml(event.title || event.event_name || "Untitled Event")}</h3>
          <div class="article-meta">
            ${event.date || event.start_date ? `<span>📅 ${new Date(event.date || event.start_date).toLocaleDateString()}</span>` : ""}
            ${event.location || event.venue_name ? `<span>📍 ${escapeHtml(event.location || event.venue_name)}</span>` : ""}
          </div>
          ${event.link || event.event_url ? `<a href="${event.link || event.event_url}" class="btn">View Event →</a>` : ""}
        </div>
      `;
    });
  }

  // Publications section
  if (digest.publications.length > 0) {
    contentHtml += `
      <div class="divider"></div>
      <h2 style="color: ${domain === "esg" ? COLORS.esg : COLORS.credit}; margin-bottom: 20px;">
        📚 Featured Publications
      </h2>
    `;
    digest.publications.slice(0, 5).forEach((pub: any) => {
      contentHtml += renderArticleCard(
        {
          id: pub.id,
          title: pub.title,
          source: pub.source,
          link: pub.link,
          date: pub.published || pub.date,
        },
        false
      );
    });
  }

  // Empty state
  if (digest.totalItems === 0) {
    contentHtml += `
      <div class="empty-state">
        <p style="font-size: 18px;">📭</p>
        <p>No team activity this week. Be the first to explore and share!</p>
      </div>
    `;
  }

  contentHtml += `
    <div class="divider"></div>
    <p style="text-align: center; color: ${COLORS.textLight};">
      That's all for this week! Check back next Monday for more updates.
    </p>
    </div>
  `;

  return emailWrapper(contentHtml, domain);
}

/**
 * Daily Digest Template
 */
export function generateDailyDigestHTML(
  user: any,
  digest: DigestData,
  domain: "esg" | "credit"
): string {
  const userName = user.first_name || user.username || "User";
  const domainUpper = domain.toUpperCase();

  let contentHtml = `
    <div class="header">
      <h1>📰 Daily Digest</h1>
      <p>${domainUpper} Portal • ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
    </div>
    <div class="content">
      <p class="greeting">Good morning, ${escapeHtml(userName)}!</p>
      <p>Here's your daily roundup of the latest ${domain.toUpperCase()} news and updates published in the last 24 hours.</p>
  `;

  // Quick stats
  contentHtml += `
    <div style="background: ${COLORS.background}; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
      <p style="margin: 0; font-size: 16px; color: ${COLORS.textLight};">
        <strong style="font-size: 24px; color: ${domain === "esg" ? COLORS.esg : COLORS.credit};">
          ${digest.totalItems}
        </strong> new ${digest.totalItems === 1 ? "item" : "items"} today
      </p>
    </div>
  `;

  // Articles
  if (digest.articles.length > 0) {
    contentHtml += `
      <h2 style="color: ${domain === "esg" ? COLORS.esg : COLORS.credit}; margin: 30px 0 20px 0;">
        📰 Latest Articles
      </h2>
    `;
    digest.articles.forEach((article) => {
      contentHtml += renderArticleCard(article, false);
    });
  }

  // Events
  if (digest.events.length > 0) {
    contentHtml += `
      <div class="divider"></div>
      <h2 style="color: ${domain === "esg" ? COLORS.esg : COLORS.credit}; margin-bottom: 20px;">
        📅 New Events
      </h2>
    `;
    digest.events.forEach((event: any) => {
      contentHtml += `
        <div class="article-card">
          <h3 class="article-title">${escapeHtml(event.title || event.event_name || "Untitled")}</h3>
          <div class="article-meta">
            ${event.date || event.start_date ? `<span>📅 ${new Date(event.date || event.start_date).toLocaleDateString()}</span>` : ""}
          </div>
          ${event.link || event.event_url ? `<a href="${event.link || event.event_url}" class="btn">Learn More →</a>` : ""}
        </div>
      `;
    });
  }

  // Empty state
  if (digest.totalItems === 0) {
    contentHtml += `
      <div class="empty-state">
        <p style="font-size: 18px;">☕</p>
        <p>No new content today. Enjoy your day!</p>
      </div>
    `;
  }

  contentHtml += `
    <div class="divider"></div>
    <p style="text-align: center; color: ${COLORS.textLight};">
      See you tomorrow with more updates!
    </p>
    </div>
  `;

  return emailWrapper(contentHtml, domain);
}

/**
 * Immediate Alert Template
 */
export function generateImmediateAlertHTML(
  user: any,
  article: DigestArticle,
  domain: "esg" | "credit"
): string {
  const userName = user.first_name || user.username || "User";
  const domainUpper = domain.toUpperCase();

  const contentHtml = `
    <div class="header">
      <h1>🚨 New Article Alert</h1>
      <p>${domainUpper} Portal • Just Published</p>
    </div>
    <div class="content">
      <p class="greeting">Hi ${escapeHtml(userName)},</p>
      <p>A new article matching your interests has just been published!</p>
      
      <div style="margin: 30px 0;">
        ${renderArticleCard(article, false)}
      </div>

      <div style="background: ${COLORS.background}; padding: 20px; border-radius: 8px; margin-top: 30px;">
        <p style="margin: 0; font-size: 14px; color: ${COLORS.textLight};">
          💡 <strong>Tip:</strong> You can adjust your alert preferences to control when and how often you receive these notifications.
        </p>
        <a href="{{PREFERENCES_URL}}" style="color: ${domain === "esg" ? COLORS.esg : COLORS.credit}; text-decoration: none; font-weight: 600;">
          Manage Preferences →
        </a>
      </div>
    </div>
  `;

  return emailWrapper(contentHtml, domain);
}

/**
 * Utility: Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m] || m);
}
