import { ChatOpenAI } from "@langchain/openai";
import { env } from "@/lib/config/env";
import { getPrisma, Domain } from "@/lib/db";

/**
 * Generate a test digest using all available liked articles (no date filter)
 * This is useful for testing when there are no likes from the last week
 */
export async function generateTestDigest(domain: Domain) {
  const prisma = getPrisma(domain);
  
  // Use a fake "last week" range for display purposes
  const today = new Date();
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() - 1); // Yesterday
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekEnd.getDate() - 6); // 7 days ago

  console.log(`Generating TEST digest for ${domain} using all available liked articles`);

  // Fetch top liked articles (NO DATE FILTER)
  let articles: any[] = [];
  
  try {
    if (domain === "esg") {
      articles = await prisma.$queryRaw`
        SELECT a.title, a.summary, a.link, COUNT(l.*)::int AS likes
        FROM likes l
        JOIN esg_articles a ON a.id = l.content_id
        WHERE COALESCE(l.content_type,'article') = 'article'
        GROUP BY a.id, a.title, a.summary, a.link
        ORDER BY likes DESC
        LIMIT 10;
      `;
    } else {
      articles = await prisma.$queryRaw`
        SELECT a.title, a.summary, a.link, COUNT(l.*)::int AS likes
        FROM likes l
        JOIN credit_articles a ON a.id = l.content_id
        WHERE COALESCE(l.content_type,'article') = 'article'
        GROUP BY a.id, a.title, a.summary, a.link
        ORDER BY likes DESC
        LIMIT 10;
      `;
    }
  } catch (error) {
    console.error("Error fetching articles for test digest:", error);
    return;
  }

  console.log(`Found ${articles.length} liked articles for test digest`);

  let content = "";

  if (articles.length === 0) {
    content = "No articles have been liked yet. Start liking articles to see them in the weekly digest!";
  } else {
    const articleContext = articles.map((a, i) => 
      `${i + 1}. Title: ${a.title}\nSummary: ${a.summary || "No summary available"}\nLink: ${a.link}\nLikes: ${a.likes}`
    ).join("\n\n");

    const llm = new ChatOpenAI({
      openAIApiKey: env.OPENAI_API_KEY,
      modelName: "gpt-4o-mini",
      temperature: 0.5,
      modelKwargs: { response_format: { type: "json_object" } },
    });

    const prompt = `
You are an expert ${domain.toUpperCase()} researcher and content strategist.

Your task:
Create a high-level **Weekly Digest Report** for the ${domain.toUpperCase()} team based on the most-liked articles from the past week.

You must:
- Synthesize insights ACROSS all articles (not one-by-one summaries).
- Highlight key themes, risks, opportunities, and forward-looking signals.
- Write in a clear, executive-friendly style suitable for senior stakeholders.
- Be concise but insightful, avoiding fluff.

Return the response as **STRICT, VALID JSON ONLY** (no extra text, no markdown) with the following structure:

{
  "meta": {
    "domain": "String (e.g., 'ESG', 'CREDIT', 'MACRO')",
    "week_label": "String (e.g., 'Week 47, 2025')",
    "date_range": "String (e.g., '10–16 November 2025')",
    "article_count": Number
  },
  "headline": "String (A punchy one-line title for this week's digest)",
  "executive_summary": "String (2–4 short paragraphs giving a powerful narrative of the week: what happened, why it matters, overall tone)",
  
  "this_week_at_a_glance": {
    "key_stats": [
      {
        "label": "String (e.g., 'Articles on climate risk')",
        "value": "String or Number (e.g., '7', '7/18')",
        "note": "String (Optional brief note, may be empty)"
      }
    ],
    "overall_tone": "String (e.g., 'Cautiously optimistic', 'Regulatory tightening dominates', etc.)"
  },

  "thematic_deep_dives": [
    {
      "theme": "String (e.g., 'Banking sector climate stress tests are accelerating')",
      "summary": "String (4–6 sentences synthesizing what the articles collectively say about this theme)",
      "supporting_articles": [
        {
          "title": "String (Article title exactly as given, if available)",
          "url": "String (Original URL exactly as provided; do NOT invent URLs)",
          "role": "String (e.g., 'Primary evidence', 'Contrasting view', 'Case study')"
        }
      ],
      "implications_for_team": "String (Very concrete: what this theme means for the ${domain.toUpperCase()} team in terms of monitoring, analysis, or strategy)",
      "time_horizon": "String (e.g., 'near-term (0–6 months)', 'medium-term (6–24 months)', 'long-term (2+ years)')"
    }
  ],

  "risk_opportunity_radar": {
    "risks": [
      {
        "title": "String (Short risk label)",
        "description": "String (What the risk is, grounded in the articles)",
        "severity": "String (e.g., 'low', 'moderate', 'high')",
        "likelihood": "String (e.g., 'low', 'medium', 'high')"
      }
    ],
    "opportunities": [
      {
        "title": "String (Short opportunity label)",
        "description": "String (What the opportunity is, grounded in the articles)",
        "time_horizon": "String (e.g., 'near-term', 'medium-term', 'long-term')"
      }
    ]
  },

  "strategic_insights": [
    {
      "insight": "String (A clear, actionable insight derived from multiple articles)",
      "rationale": "String (How the articles support this insight; mention patterns, not single isolated facts)",
      "recommended_actions": [
        "String (Concrete steps the ${domain.toUpperCase()} team could take: e.g., 'Add X to monitoring list', 'Prepare a short note on Y for internal stakeholders')"
      ]
    }
  ],

  "watchlist": [
    {
      "item": "String (Company / country / sector / topic)",
      "reason": "String (Why this is on the watchlist, based on signals in the articles)",
      "articles": [
        {
          "title": "String",
          "url": "String"
        }
      ]
    }
  ],

  "curated_reading_list": [
    {
      "title": "String (Clean, human-readable article title)",
      "url": "String (Original URL, unchanged)",
      "priority": "String (e.g., 'must-read', 'recommended', 'nice-to-know')",
      "context": "String (1–2 sentences explaining why to read this and how it connects to the week's themes)"
    }
  ]
}

Rules:
- Use ONLY the information from the provided articles. Do NOT invent facts, titles, or URLs.
- If multiple articles cover similar content, treat them as a single theme and synthesize.
- Keep the tone professional, insight-driven, and decision-oriented.
- Ensure the JSON is strictly valid: double quotes for keys and strings, no trailing commas, no comments or extra text.

Here are the articles:
${articleContext}
`;

    try {
      const response = await llm.invoke(prompt);
      content = response.content as string;
    } catch (error) {
      console.error("Error generating test digest with AI:", error);
      content = "Error generating digest. Please try again later.";
    }
  }

  // Save to database
  try {
    await prisma.$executeRaw`
      INSERT INTO weekly_digest (week_start, week_end, content, created_at)
      VALUES (${weekStart}, ${weekEnd}, ${content}, NOW())
    `;
    console.log(`Test digest for ${domain} saved successfully.`);
  } catch (error) {
    console.error("Error saving test digest to database:", error);
  }
  
  return content;
}
