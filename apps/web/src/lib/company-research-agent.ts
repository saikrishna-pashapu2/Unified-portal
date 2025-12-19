/**
 * Company Deep Research Agent v3.0 - HYBRID
 * 
 * Comprehensive AI-powered company research tool for business development.
 * Hybrid approach: Phase 1 (broad parallel searches) + Phase 2 (intelligent agent follow-ups) + Phase 3 (synthesis)
 * 
 * @server-only
 */

import "server-only";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// Research finding types for categorization
export type FindingType = 
  | "company_overview"
  | "company_history"
  | "financial_data"
  | "esg_performance"
  | "credit_ratings"
  | "products_services"
  | "leadership_team"
  | "contact_information"
  | "sustainability_reports"
  | "financial_reports"
  | "regulatory_filings"
  | "news_updates"
  | "industry_analysis"
  | "competitive_landscape"
  | "risk_assessment"
  | "ownership_structure"
  | "geographic_presence"
  | "partnerships_deals"
  | "controversy_analysis"
  | "investor_relations";

// Interface for research findings
export interface ResearchFinding {
  type: FindingType;
  title: string;
  content: string;
  source_url?: string;
  source_name?: string;
  confidence_score: number;
  metadata?: Record<string, any>;
}

// Interface for company contact
export interface CompanyContact {
  full_name: string;
  job_title?: string;
  department?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  source_url?: string;
  relevance_score: number;
}

// Interface for the final research report
export interface CompanyResearchReport {
  company_profile: {
    name: string;
    ticker?: string;
    origin_country?: string;
    listed_country?: string;
    is_publicly_listed: boolean;
    founded_year?: string;
    headquarters?: string;
    website?: string;
    industry?: string;
    sector?: string;
    company_size?: string;
    employee_count?: string;
  };
  executive_summary: string;
  findings: ResearchFinding[];
  contacts: CompanyContact[];
  html_content: string;
  research_metadata: {
    total_sources_consulted: number;
    research_duration_seconds: number;
    tokens_used: number;
    model_used: string;
  };
}

// Tavily web search helper with enhanced options
async function tavilySearch(query: string, options?: {
  search_depth?: "basic" | "advanced";
  max_results?: number;
  include_domains?: string[];
  exclude_domains?: string[];
  topic?: "general" | "news" | "finance";
}): Promise<{
  answer?: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
    published_date?: string;
  }>;
}> {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) {
    throw new Error("TAVILY_API_KEY is not configured");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      query,
      search_depth: options?.search_depth || "advanced",
      max_results: options?.max_results || 10,
      include_domains: options?.include_domains,
      exclude_domains: options?.exclude_domains,
      include_answer: true,
      include_raw_content: false,
      topic: options?.topic || "general",
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.statusText}`);
  }

  return response.json();
}

// Research phase definitions for systematic coverage
interface ResearchPhase {
  name: string;
  queries: (companyName: string) => string[];
  domains?: string[];
  topic?: "general" | "news" | "finance";
}

const RESEARCH_PHASES: ResearchPhase[] = [
  {
    name: "Company Fundamentals",
    queries: (name) => [
      `"${name}" company overview history founding headquarters official website`,
      `"${name}" about us mission vision values company profile`,
      `"${name}" company size employees headcount workforce 2024 2025`,
    ],
    domains: ["linkedin.com", "bloomberg.com", "reuters.com", "crunchbase.com", "wikipedia.org"],
  },
  {
    name: "Financial Performance",
    queries: (name) => [
      `"${name}" revenue earnings profit Q3 Q4 2024 2025 financial results`,
      `"${name}" stock price market cap valuation investor relations`,
      `"${name}" annual report 10-K SEC filing financial statements 2024`,
      `"${name}" funding round investment venture capital IPO valuation`,
    ],
    domains: ["sec.gov", "yahoo.com", "finance.yahoo.com", "bloomberg.com", "wsj.com", "ft.com", "marketwatch.com", "seekingalpha.com"],
    topic: "finance",
  },
  {
    name: "ESG Ratings & Performance",
    queries: (name) => [
      `"${name}" ESG rating score MSCI 2024 2025`,
      `"${name}" Sustainalytics ESG risk rating score`,
      `"${name}" S&P Global ESG score CSA corporate sustainability assessment`,
      `"${name}" CDP climate score carbon disclosure project rating`,
      `"${name}" ISS ESG governance quality score rating`,
      `"${name}" LSEG Refinitiv ESG score rating`,
      `"${name}" sustainability report 2024 2025 ESG report PDF download`,
      `"${name}" carbon emissions net zero 2050 climate targets SBTi`,
      `"${name}" diversity inclusion DEI workforce metrics gender pay gap`,
    ],
    domains: ["msci.com", "sustainalytics.com", "spglobal.com", "cdp.net", "issgovernance.com", "refinitiv.com", "lseg.com"],
  },
  {
    name: "Credit Ratings",
    queries: (name) => [
      `"${name}" Moody's credit rating 2024 2025`,
      `"${name}" S&P credit rating outlook 2024 2025`,
      `"${name}" Fitch credit rating 2024 2025`,
      `"${name}" bond rating investment grade credit outlook debt`,
    ],
    domains: ["moodys.com", "spglobal.com", "fitchratings.com", "bloomberg.com", "reuters.com"],
    topic: "finance",
  },
  {
    name: "Leadership & Governance",
    queries: (name) => [
      `"${name}" CEO CFO COO executive team leadership management biography`,
      `"${name}" board of directors members chairman composition`,
      `"${name}" chief sustainability officer CSO ESG officer`,
      `"${name}" executive compensation CEO pay ratio proxy statement`,
    ],
    domains: ["linkedin.com", "bloomberg.com", "reuters.com"],
  },
  {
    name: "Contact Information",
    queries: (name) => [
      `"${name}" investor relations contact email phone IR team`,
      `"${name}" sustainability ESG team contact email`,
      `"${name}" business development partnerships team contact`,
      `"${name}" procurement vendor management purchasing contact`,
      `"${name}" media relations press contact email`,
    ],
    domains: ["linkedin.com"],
  },
  {
    name: "Products & Business Model",
    queries: (name) => [
      `"${name}" products services offerings portfolio complete list`,
      `"${name}" business model revenue streams how makes money`,
      `"${name}" target market customers B2B B2C enterprise segments`,
      `"${name}" competitive advantage unique value proposition moat`,
      `"${name}" technology platform patents intellectual property`,
    ],
  },
  {
    name: "Competitive Landscape",
    queries: (name) => [
      `"${name}" competitors competitive analysis market share industry`,
      `"${name}" industry ranking market position leader comparison`,
      `"${name}" vs competitors alternative companies similar to`,
      `"${name}" market share percentage industry 2024`,
    ],
  },
  {
    name: "Recent News & Strategic Moves",
    queries: (name) => [
      `"${name}" latest news announcements December 2025`,
      `"${name}" acquisitions mergers M&A deals 2024 2025`,
      `"${name}" partnerships alliances collaborations strategic 2024 2025`,
      `"${name}" expansion new markets products launches 2025`,
      `"${name}" restructuring layoffs cost cutting 2024 2025`,
    ],
    topic: "news",
  },
  {
    name: "Risks & Controversies",
    queries: (name) => [
      `"${name}" risks challenges regulatory compliance issues 2024 2025`,
      `"${name}" controversies scandals lawsuits investigations fines`,
      `"${name}" ESG controversies labor violations environmental issues`,
      `"${name}" cybersecurity breach data privacy incidents`,
      `"${name}" supply chain issues disruptions problems`,
    ],
    topic: "news",
  },
  {
    name: "Ownership & Investors",
    queries: (name) => [
      `"${name}" major shareholders institutional investors ownership`,
      `"${name}" largest investors funds holdings stake`,
      `"${name}" insider ownership executive stock holdings`,
    ],
    topic: "finance",
  },
];

/**
 * Execute a single research phase with rate limiting
 */
async function executeResearchPhase(
  phase: ResearchPhase,
  companyName: string
): Promise<{ findings: string[]; sources: number }> {
  const findings: string[] = [];
  let sourcesCount = 0;

  // Get queries by calling the function with company name
  const queries = phase.queries(companyName);

  for (const query of queries) {
    try {
      const result = await tavilySearch(query, {
        search_depth: "advanced",
        max_results: 8,
        include_domains: phase.domains,
        topic: phase.topic,
      });

      sourcesCount += result.results.length;

      if (result.answer) {
        findings.push(`[AI Summary] ${result.answer}`);
      }

      for (const r of result.results) {
        findings.push(`**${r.title}**\nURL: ${r.url}\n${r.content}${r.published_date ? `\n(Published: ${r.published_date})` : ""}`);
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Search error for "${phase.name}":`, error);
    }
  }

  return { findings, sources: sourcesCount };
}

/**
 * Main function to conduct comprehensive company research
 */
export async function conductCompanyResearch(
  companyName: string,
  options?: {
    includeFinancials?: boolean;
    includeESG?: boolean;
    includeContacts?: boolean;
    maxSearches?: number;
  }
): Promise<CompanyResearchReport> {
  const startTime = Date.now();
  let totalTokens = 0;
  const allFindings: ResearchFinding[] = [];
  const allContacts: CompanyContact[] = [];
  let totalSourcesConsulted = 0;

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  console.log(`🔍 Starting comprehensive research for: ${companyName}`);

  // Phase 1: Execute all research phases
  const phaseResults: Map<string, string[]> = new Map();
  
  // Execute phases in batches of 2 to avoid rate limits
  const batchSize = 2;
  for (let i = 0; i < RESEARCH_PHASES.length; i += batchSize) {
    const batch = RESEARCH_PHASES.slice(i, i + batchSize);
    const batchPromises = batch.map(async (phase) => {
      console.log(`  📊 Researching: ${phase.name}`);
      const result = await executeResearchPhase(phase, companyName);
      totalSourcesConsulted += result.sources;
      return { name: phase.name, findings: result.findings };
    });

    const batchResults = await Promise.all(batchPromises);
    for (const result of batchResults) {
      phaseResults.set(result.name, result.findings);
    }
    
    // Delay between batches
    if (i + batchSize < RESEARCH_PHASES.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log(`✅ Phase 1 complete: ${totalSourcesConsulted} sources consulted`);

  // ============================================
  // PHASE 2: Intelligent Agent Follow-up Searches
  // ============================================
  // Agent reviews initial findings and identifies gaps to fill
  
  const agentLlm = new ChatOpenAI({
    openAIApiKey: openaiApiKey,
    modelName: "gpt-5-mini",
  });

  // Create search tool for the agent
  const deepSearchTool = new DynamicStructuredTool({
    name: "deep_search",
    description: "Search for specific information about the company. Use this to fill gaps in research or follow up on interesting leads.",
    schema: z.object({
      query: z.string().describe("Specific search query - include company name and exact information needed"),
      reason: z.string().describe("Why this search is needed - what gap are you filling?"),
    }),
    func: async ({ query, reason }) => {
      console.log(`    🔎 Agent search: ${reason}`);
      try {
        const result = await tavilySearch(query, {
          search_depth: "advanced",
          max_results: 6,
        });
        totalSourcesConsulted += result.results.length;
        
        let output = "";
        if (result.answer) {
          output += `Summary: ${result.answer}\n\n`;
        }
        for (const r of result.results.slice(0, 5)) {
          output += `[${r.title}](${r.url})\n${r.content}\n\n`;
          // Add to phase results for later analysis
          const agentFindings = phaseResults.get("Agent Follow-ups") || [];
          agentFindings.push(`**${r.title}**\nURL: ${r.url}\n${r.content}`);
          phaseResults.set("Agent Follow-ups", agentFindings);
        }
        return output || "No results found.";
      } catch (error) {
        return `Search failed: ${error}`;
      }
    },
  });

  const extractInsightTool = new DynamicStructuredTool({
    name: "record_insight",
    description: "Record an important insight or finding discovered during research",
    schema: z.object({
      category: z.enum(["esg_rating", "credit_rating", "financial_metric", "contact", "risk", "opportunity", "key_fact"]),
      title: z.string().describe("Short title for the insight"),
      detail: z.string().describe("The specific information discovered"),
      source_url: z.string().optional().describe("URL where this was found"),
      confidence: z.number().min(0).max(1).describe("How confident (0-1) in this information"),
    }),
    func: async ({ category, title, detail, source_url, confidence }) => {
      // Record as additional finding
      const insightFindings = phaseResults.get("Agent Insights") || [];
      insightFindings.push(`**[${category.toUpperCase()}] ${title}** (${Math.round(confidence * 100)}% confidence)\n${detail}${source_url ? `\nSource: ${source_url}` : ""}`);
      phaseResults.set("Agent Insights", insightFindings);
      return `Recorded: ${title}`;
    },
  });

  const tools = [deepSearchTool, extractInsightTool];
  const agentWithTools = agentLlm.bindTools(tools);

  // Prepare summary of Phase 1 findings for agent
  let phase1Summary = `# Initial Research Summary for ${companyName}\n\n`;
  Array.from(phaseResults.entries()).forEach(([phaseName, findings]) => {
    phase1Summary += `## ${phaseName}\n`;
    phase1Summary += `Found ${findings.length} results.\n`;
    // Include first few findings as context
    for (const finding of findings.slice(0, 3)) {
      phase1Summary += `- ${finding.substring(0, 300)}...\n`;
    }
    phase1Summary += "\n";
  });

  // Agent prompt to identify gaps and follow up
  const agentSystemPrompt = `You are an expert Business Intelligence Research Agent. You've just received initial research findings about "${companyName}".

Your job is to:
1. ANALYZE what information was found vs what's missing
2. RUN TARGETED SEARCHES to fill critical gaps
3. FOLLOW UP on interesting leads (e.g., if you found a CEO name, search for their LinkedIn)
4. RECORD important insights using the record_insight tool

## CRITICAL GAPS TO CHECK AND FILL:

### ESG Ratings (search for each if not found):
- MSCI ESG Rating (AAA to CCC scale)
- Sustainalytics ESG Risk Rating (0-100, lower is better)
- S&P Global ESG Score (0-100)
- CDP Climate Score (A to D-)
- ISS ESG Rating
- LSEG/Refinitiv ESG Score

### Credit Ratings:
- Moody's rating and outlook
- S&P rating and outlook
- Fitch rating and outlook

### Key Contacts to Find:
- Investor Relations contact (email/phone)
- Chief Sustainability Officer / ESG lead
- Business Development / Partnerships contact
- Procurement / Vendor Management contact

### Financial Data:
- Latest quarterly revenue and earnings
- Market cap and P/E ratio
- Debt-to-equity ratio

### Leadership:
- Full C-suite with backgrounds
- Board composition

## INSTRUCTIONS:
1. Review what's already found
2. Identify the MOST IMPORTANT missing information
3. Run up to 8 targeted searches to fill gaps
4. Use record_insight to capture specific data points (ratings, metrics, contacts)
5. Be efficient - don't duplicate searches already done

Current date: ${new Date().toISOString().split('T')[0]}`;

  const agentMessages: any[] = [
    new SystemMessage(agentSystemPrompt),
    new HumanMessage(`Here's what Phase 1 research found:\n\n${phase1Summary}\n\nNow analyze what's missing and run targeted follow-up searches to fill the gaps. Focus on ESG ratings, credit ratings, specific contacts, and financial metrics.`),
  ];

  console.log(`🤖 Phase 2: Agent analyzing gaps and running follow-up searches...`);

  // Agent loop - let it run up to 10 iterations
  let agentIterations = 0;
  const maxAgentIterations = 10;

  while (agentIterations < maxAgentIterations) {
    agentIterations++;
    
    try {
      const response = await agentWithTools.invoke(agentMessages);
      totalTokens += response.usage_metadata?.total_tokens || 0;
      agentMessages.push(response);

      // Check for tool calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolResults: ToolMessage[] = [];
        
        for (const toolCall of response.tool_calls) {
          const tool = tools.find(t => t.name === toolCall.name);
          if (tool) {
            try {
              // Use func directly instead of invoke to avoid type issues
              const toolResult = await tool.func(toolCall.args as any);
              toolResults.push(new ToolMessage({
                content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
                tool_call_id: toolCall.id!,
              }));
            } catch (toolError) {
              console.error(`Tool ${toolCall.name} error:`, toolError);
              toolResults.push(new ToolMessage({
                content: `Error: ${toolError instanceof Error ? toolError.message : 'Tool execution failed'}`,
                tool_call_id: toolCall.id!,
              }));
            }
          }
        }
        
        agentMessages.push(...toolResults);
      } else {
        // No more tool calls - agent is done
        console.log(`  ✅ Agent completed after ${agentIterations} iterations`);
        break;
      }
    } catch (error) {
      console.error("Agent iteration error:", error);
      break;
    }
  }

  console.log(`✅ Phase 2 complete: Agent ran ${agentIterations} iterations`);

  // ============================================
  // PHASE 3: Synthesis and Report Generation
  // ============================================
  
  const llm = new ChatOpenAI({
    openAIApiKey: openaiApiKey,
    modelName: "gpt-5-mini",
  });

  // Prepare research context for analysis (limit to avoid token limits)
  let researchContext = "";
  Array.from(phaseResults.entries()).forEach(([phaseName, findings]) => {
    researchContext += `\n\n## ${phaseName}\n\n`;
    // Take top findings per phase
    const topFindings = findings.slice(0, 12);
    for (const finding of topFindings) {
      researchContext += `${finding}\n\n---\n`;
    }
  });

  // Truncate if too long (roughly 60k chars = ~15k tokens)
  if (researchContext.length > 60000) {
    researchContext = researchContext.substring(0, 60000) + "\n\n[... additional sources truncated for analysis ...]";
  }

  console.log(`📝 Phase 3: Synthesizing ${researchContext.length} characters into final report...`);

  // Analysis prompt for structured extraction
  const analysisPrompt = `You are an expert Business Intelligence Analyst creating a comprehensive company research report.

# Research Data for ${companyName}
${researchContext}

# Your Task
Analyze ALL the research data above and create a comprehensive intelligence report. Extract EVERY piece of relevant information found.

Return a JSON object with this EXACT structure:

{
  "company_profile": {
    "name": "Official company name",
    "ticker": "Stock ticker symbol or null",
    "origin_country": "Country of headquarters",
    "listed_country": "Stock exchange country or null",
    "is_publicly_listed": true or false,
    "founded_year": "YYYY or null",
    "headquarters": "City, Country",
    "website": "https://...",
    "industry": "Primary industry",
    "sector": "Business sector",
    "company_size": "Large Enterprise/Mid-Market/SMB/Startup",
    "employee_count": "Number (e.g., '125,000')"
  },
  "executive_summary": "4-5 paragraph comprehensive summary covering: (1) Company overview and market position, (2) Financial health and performance, (3) ESG profile and sustainability initiatives, (4) Key risks and opportunities, (5) Business development implications. Include specific numbers, ratings, and facts.",
  "sections": [
    {
      "id": "overview",
      "title": "Company Overview & History",
      "content": "Detailed overview including founding story, key milestones, evolution, current operations, and global presence. Be comprehensive.",
      "key_facts": ["Fact 1 with specific detail", "Fact 2", "Fact 3", "Fact 4", "Fact 5"],
      "sources": [{"name": "Source Name", "url": "https://..."}]
    },
    {
      "id": "business",
      "title": "Business Model & Products/Services",
      "content": "Complete product/service portfolio, revenue streams, business model, target markets, and value proposition.",
      "key_facts": ["Specific product/service", "Revenue model", "Market segment"],
      "sources": [{"name": "Source Name", "url": "https://..."}]
    },
    {
      "id": "financials",
      "title": "Financial Performance",
      "content": "Latest revenue, earnings, growth rates, market cap, valuation metrics, debt levels, and financial outlook. Include Q3/Q4 2024 or 2025 data where available.",
      "key_facts": ["Revenue: $XX billion (period)", "Net Income: $XX", "Market Cap: $XX", "YoY Growth: XX%", "P/E Ratio: XX"],
      "sources": [{"name": "Source Name", "url": "https://..."}]
    },
    {
      "id": "esg",
      "title": "ESG Performance & Ratings",
      "content": "All ESG ratings found (MSCI, Sustainalytics, S&P Global, CDP, ISS, LSEG), sustainability initiatives, carbon targets, DEI metrics, and governance quality.",
      "key_facts": ["MSCI ESG Rating: XX", "Sustainalytics Risk: XX", "S&P Global Score: XX", "CDP Climate: X", "Net-Zero Target: Year"],
      "sources": [{"name": "Source Name", "url": "https://..."}]
    },
    {
      "id": "credit",
      "title": "Credit Ratings & Debt Profile",
      "content": "Credit ratings from Moody's, S&P, Fitch. Include outlook, recent changes, debt metrics.",
      "key_facts": ["Moody's: Xxx", "S&P: XXX", "Fitch: XXX", "Outlook: Stable/Positive/Negative"],
      "sources": [{"name": "Source Name", "url": "https://..."}]
    },
    {
      "id": "leadership",
      "title": "Leadership & Governance",
      "content": "Executive team (CEO, CFO, COO, CSO), board composition, governance structure, recent leadership changes.",
      "key_facts": ["CEO: Name (since Year)", "CFO: Name", "CSO: Name", "Board Size: X"],
      "sources": [{"name": "Source Name", "url": "https://..."}]
    },
    {
      "id": "competitive",
      "title": "Competitive Position",
      "content": "Market share, key competitors, competitive advantages, industry ranking.",
      "key_facts": ["Market Position: #X", "Key Competitors: A, B, C", "Market Share: XX%"],
      "sources": [{"name": "Source Name", "url": "https://..."}]
    },
    {
      "id": "news",
      "title": "Recent Developments",
      "content": "Recent news, M&A activity, partnerships, product launches from past 12 months.",
      "key_facts": ["Recent announcement with date", "M&A or partnership"],
      "sources": [{"name": "Source Name", "url": "https://..."}]
    },
    {
      "id": "risks",
      "title": "Risks & Controversies",
      "content": "Known risks, regulatory issues, controversies, lawsuits, ESG concerns.",
      "key_facts": ["Risk or controversy 1", "Risk or controversy 2"],
      "sources": [{"name": "Source Name", "url": "https://..."}]
    },
    {
      "id": "ownership",
      "title": "Ownership Structure",
      "content": "Major shareholders, institutional investors, insider ownership.",
      "key_facts": ["Top shareholder: Name (XX%)", "Institutional ownership: XX%"],
      "sources": [{"name": "Source Name", "url": "https://..."}]
    },
    {
      "id": "bd_intel",
      "title": "Business Development Insights",
      "content": "Strategic entry points, partnership opportunities, key decision-makers, recommended approach for business development.",
      "key_facts": ["BD opportunity", "Key contact role", "Recommended approach"],
      "sources": [{"name": "Source Name", "url": "https://..."}]
    }
  ],
  "contacts": [
    {
      "full_name": "Name from research",
      "job_title": "Title",
      "department": "Investor Relations/ESG/BD/etc",
      "email": "email or null",
      "phone": "phone or null",
      "linkedin_url": "url or null",
      "source_url": "where found",
      "relevance_score": 0.9
    }
  ]
}

CRITICAL INSTRUCTIONS:
1. Include EVERY ESG rating found (MSCI, Sustainalytics, S&P, CDP, ISS, LSEG/Refinitiv)
2. Include ALL credit ratings (Moody's, S&P, Fitch) with outlook
3. Include specific financial numbers with dates/periods
4. Extract ALL leadership names mentioned
5. List ALL contacts found (IR, ESG, BD, Procurement, Media)
6. Use [text](url) markdown format for source links in content
7. Be comprehensive - include all data found, don't summarize away details
8. If data not found, say "Not disclosed" or "Not found" - never make up data

Return ONLY valid JSON, no markdown code blocks.`;

  try {
    const analysisResponse = await llm.invoke([
      new SystemMessage("You are an expert business intelligence analyst. Return ONLY valid JSON with no markdown formatting."),
      new HumanMessage(analysisPrompt),
    ]);

    totalTokens += analysisResponse.usage_metadata?.total_tokens || 0;

    let parsedReport: any;
    try {
      // Extract JSON from response
      let content = analysisResponse.content as string;
      // Remove markdown code blocks if present
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedReport = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Failed to parse analysis response:", parseError);
      parsedReport = {
        company_profile: { name: companyName, is_publicly_listed: false },
        executive_summary: "Analysis could not be completed. Raw research data was collected but structured analysis failed. Please try again.",
        sections: [],
        contacts: [],
      };
    }

    // Extract contacts from parsed report
    if (parsedReport.contacts && Array.isArray(parsedReport.contacts)) {
      for (const contact of parsedReport.contacts) {
        if (contact.full_name) {
          allContacts.push({
            full_name: contact.full_name,
            job_title: contact.job_title,
            department: contact.department,
            email: contact.email,
            phone: contact.phone,
            linkedin_url: contact.linkedin_url,
            source_url: contact.source_url,
            relevance_score: contact.relevance_score || 0.5,
          });
        }
      }
    }

    // Convert sections to findings
    if (parsedReport.sections && Array.isArray(parsedReport.sections)) {
      for (const section of parsedReport.sections) {
        const findingType = mapSectionToFindingType(section.id);
        allFindings.push({
          type: findingType,
          title: section.title,
          content: section.content,
          source_url: section.sources?.[0]?.url,
          source_name: section.sources?.[0]?.name,
          confidence_score: 0.85,
          metadata: {
            key_facts: section.key_facts,
            sources: section.sources,
          },
        });
      }
    }

    // Generate HTML content from the report
    const htmlContent = generateHTMLReport(parsedReport, allFindings, allContacts);

    const endTime = Date.now();
    const durationSeconds = (endTime - startTime) / 1000;

    console.log(`✅ Research complete: ${durationSeconds.toFixed(1)}s, ${totalSourcesConsulted} sources, ${totalTokens} tokens`);

    return {
      company_profile: parsedReport.company_profile || { name: companyName, is_publicly_listed: false },
      executive_summary: parsedReport.executive_summary || "",
      findings: allFindings,
      contacts: allContacts,
      html_content: htmlContent,
      research_metadata: {
        total_sources_consulted: totalSourcesConsulted,
        research_duration_seconds: durationSeconds,
        tokens_used: totalTokens,
        model_used: "gpt-4o",
      },
    };
  } catch (error) {
    console.error("Research analysis error:", error);
    throw error;
  }
}

function mapSectionToFindingType(sectionId: string): FindingType {
  const mapping: Record<string, FindingType> = {
    overview: "company_overview",
    business: "products_services",
    financials: "financial_data",
    esg: "esg_performance",
    credit: "credit_ratings",
    leadership: "leadership_team",
    competitive: "competitive_landscape",
    news: "news_updates",
    risks: "risk_assessment",
    ownership: "ownership_structure",
    bd_intel: "partnerships_deals",
  };
  return mapping[sectionId] || "company_overview";
}

/**
 * Generate formatted HTML report from research data
 */
function generateHTMLReport(
  report: any,
  findings: ResearchFinding[],
  contacts: CompanyContact[]
): string {
  const profile = report.company_profile || {};
  const sections = report.sections || [];

  let html = `
<div class="company-research-report space-y-8">
  <!-- Header with Company Info -->
  <header class="pb-6 border-b border-gray-200 dark:border-gray-700">
    <div class="flex items-start justify-between flex-wrap gap-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">${escapeHtml(profile.name || "Company Research Report")}</h1>
        <div class="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-600 dark:text-gray-400">
          ${profile.ticker ? `<span class="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded font-mono font-semibold">${escapeHtml(profile.ticker)}</span>` : ""}
          ${profile.origin_country ? `<span>📍 ${escapeHtml(profile.origin_country)}</span>` : ""}
          ${profile.industry ? `<span>🏢 ${escapeHtml(profile.industry)}</span>` : ""}
          ${profile.is_publicly_listed ? `<span class="text-green-600 dark:text-green-400 font-medium">● Public</span>` : `<span class="text-gray-500">● Private</span>`}
        </div>
        ${profile.website ? `<a href="${escapeHtml(profile.website)}" target="_blank" rel="noopener" class="text-sm text-blue-600 dark:text-blue-400 hover:underline mt-2 inline-block">🌐 ${escapeHtml(profile.website)}</a>` : ""}
      </div>
    </div>
  </header>

  <!-- Executive Summary -->
  <section class="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-900 rounded-xl border border-blue-100 dark:border-gray-700">
    <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
      📋 Executive Summary
    </h2>
    <div class="prose prose-slate dark:prose-invert max-w-none">
      <div class="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">${formatContent(report.executive_summary || "Research in progress...")}</div>
    </div>
  </section>

  <!-- Quick Facts Grid -->
  <section>
    <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">📊 Quick Facts</h2>
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      ${generateQuickFactCard("Industry", profile.industry, "🏢")}
      ${generateQuickFactCard("Sector", profile.sector, "📈")}
      ${generateQuickFactCard("Founded", profile.founded_year, "📅")}
      ${generateQuickFactCard("Employees", profile.employee_count, "👥")}
      ${generateQuickFactCard("HQ", profile.headquarters || profile.origin_country, "📍")}
      ${generateQuickFactCard("Ticker", profile.ticker || "Private", "💹")}
      ${generateQuickFactCard("Exchange", profile.listed_country || "N/A", "🏛️")}
      ${generateQuickFactCard("Size", profile.company_size, "📏")}
    </div>
  </section>
`;

  // Section icons mapping
  const sectionIcons: Record<string, string> = {
    overview: "🏛️",
    business: "💼",
    financials: "💰",
    esg: "🌱",
    credit: "📊",
    leadership: "👔",
    competitive: "🏆",
    news: "📰",
    risks: "⚠️",
    ownership: "🏦",
    bd_intel: "💡",
  };

  // Add research sections
  for (const section of sections) {
    const icon = sectionIcons[section.id] || "📌";
    const bgColor = section.id === "esg" ? "from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-200 dark:border-green-800" :
                    section.id === "financials" ? "from-yellow-50 to-amber-50 dark:from-yellow-900/20 dark:to-amber-900/20 border-yellow-200 dark:border-yellow-800" :
                    section.id === "risks" ? "from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/20 border-red-200 dark:border-red-800" :
                    "from-gray-50 to-slate-50 dark:from-gray-800 dark:to-slate-800 border-gray-200 dark:border-gray-700";
    
    html += `
  <section class="rounded-xl overflow-hidden border bg-gradient-to-br ${bgColor}">
    <div class="px-6 py-4 border-b border-inherit">
      <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <span class="text-xl">${icon}</span>
        ${escapeHtml(section.title)}
      </h2>
    </div>
    <div class="p-6 bg-white/50 dark:bg-gray-900/50">
      <div class="prose prose-slate dark:prose-invert max-w-none">
        <div class="text-gray-700 dark:text-gray-300 leading-relaxed">${formatContent(section.content)}</div>
      </div>
      
      ${section.key_facts && section.key_facts.length > 0 ? `
      <div class="mt-6 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">📌 Key Facts</h4>
        <ul class="grid grid-cols-1 md:grid-cols-2 gap-2">
          ${section.key_facts.map((f: string) => `<li class="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"><span class="text-green-500 mt-0.5 flex-shrink-0">✓</span><span>${formatContent(f)}</span></li>`).join("")}
        </ul>
      </div>
      ` : ""}
      
      ${section.sources && section.sources.length > 0 ? `
      <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <p class="text-xs text-gray-500 dark:text-gray-400">
          🔗 Sources: ${section.sources.map((s: any) => `<a href="${escapeHtml(s.url || '#')}" target="_blank" rel="noopener" class="text-blue-600 dark:text-blue-400 hover:underline">${escapeHtml(s.name || 'Source')}</a>`).join(" • ")}
        </p>
      </div>
      ` : ""}
    </div>
  </section>
`;
  }

  // Add contacts section if any
  if (contacts.length > 0) {
    html += `
  <section class="rounded-xl overflow-hidden border border-orange-200 dark:border-orange-800 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20">
    <div class="px-6 py-4 border-b border-orange-200 dark:border-orange-800">
      <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <span class="text-xl">👥</span>
        Key Contacts for Business Development
      </h2>
    </div>
    <div class="p-6 bg-white/50 dark:bg-gray-900/50">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${contacts.map(contact => `
        <div class="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:shadow-md transition-shadow">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h4 class="font-semibold text-gray-900 dark:text-gray-100 truncate">${escapeHtml(contact.full_name)}</h4>
              ${contact.job_title ? `<p class="text-sm text-gray-600 dark:text-gray-400 truncate">${escapeHtml(contact.job_title)}</p>` : ""}
              ${contact.department ? `<p class="text-xs text-blue-600 dark:text-blue-400 mt-1">${escapeHtml(contact.department)}</p>` : ""}
            </div>
            <span class="flex-shrink-0 text-xs px-2 py-1 rounded ${contact.relevance_score >= 0.8 ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : contact.relevance_score >= 0.5 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" : "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"}">${Math.round(contact.relevance_score * 100)}%</span>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            ${contact.email ? `<a href="mailto:${escapeHtml(contact.email)}" class="inline-flex items-center gap-1 text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-800">📧 Email</a>` : ""}
            ${contact.linkedin_url ? `<a href="${escapeHtml(contact.linkedin_url)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-800">💼 LinkedIn</a>` : ""}
            ${contact.phone ? `<span class="inline-flex items-center gap-1 text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded">📞 ${escapeHtml(contact.phone)}</span>` : ""}
          </div>
        </div>
        `).join("")}
      </div>
    </div>
  </section>
`;
  }

  html += `</div>`;

  return html;
}

function generateQuickFactCard(label: string, value: string | null | undefined, icon: string): string {
  const displayValue = value || "N/A";
  
  return `
    <div class="p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
      <div class="flex items-center gap-1.5 mb-1">
        <span class="text-sm">${icon}</span>
        <p class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">${escapeHtml(label)}</p>
      </div>
      <p class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">${escapeHtml(displayValue)}</p>
    </div>
  `;
}

function escapeHtml(text: string): string {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatContent(content: string): string {
  if (!content) return "";
  
  let formatted = String(content);
  
  // Convert markdown links to HTML
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-blue-600 dark:text-blue-400 hover:underline">$1</a>');
  
  // Convert bold text
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold">$1</strong>');
  
  // Convert bullet points
  formatted = formatted.replace(/^[\-•]\s+/gm, '• ');
  
  // Preserve line breaks
  formatted = formatted.replace(/\n/g, '<br/>');
  
  return formatted;
}
