/**
 * Article Assistant Agent using LangGraph
 * Provides article summarization and Q&A capabilities
 * 
 * @server-only
 */

import "server-only";
import { ChatOpenAI } from "@langchain/openai";
// import { StateGraph, END, START } from "@langchain/langgraph"; // Unused - kept for reference
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
// import { ToolNode } from "@langchain/langgraph/prebuilt"; // Unused - kept for reference
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// Define the state for our agent (unused - kept for reference)
/*
export interface ArticleAssistantState {
  messages: BaseMessage[];
  articleContent: string;
  articleTitle: string;
  articleSource: "esg" | "credit";
  articleId: number;
  summary?: string;
  needsWebSearch?: boolean;
  finalAnswer?: string;
}
*/

/**
 * Generate summary for an article
 */
export async function generateArticleSummary(
  articleContent: string,
  articleTitle: string,
  openaiApiKey: string
): Promise<{ summary: string; tokens: number }> {
  const llm = new ChatOpenAI({
    openAIApiKey: openaiApiKey,
    modelName: "gpt-4o-mini",
    temperature: 0.5,
  });

  const systemPrompt = `You are an expert article summarizer. Generate a structured summary with two sections:

**Format:**

1. **Overview** (2-3 sentences): A brief, high-level summary of what the article is about. Make it concise and informative.

2. **Key Points** (3-5 bullet points): Important highlights, facts, and takeaways from the article.
   • Each bullet should be clear and specific
   • Focus on actionable insights and important facts
   • Keep bullets concise (1-2 sentences max)

Article: "${articleTitle}"

Content:
${articleContent.slice(0, 4000)} ${articleContent.length > 4000 ? "..." : ""}

Generate the structured summary now with "Overview" section first, then "Key Points" as bullet points:`;

  const response = await llm.invoke([new SystemMessage(systemPrompt)]);

  // Estimate tokens (rough calculation: ~1 token per 4 characters)
  const estimatedTokens = Math.ceil(
    (systemPrompt.length + (response.content as string).length) / 4
  );

  return {
    summary: response.content as string,
    tokens: estimatedTokens,
  };
}

/**
 * Stream chat responses with tool support
 */
export async function streamArticleChat(
  messages: { role: string; content: string }[],
  articleContent: string,
  articleTitle: string,
  articleSummary: string | null,
  openaiApiKey: string
): Promise<AsyncGenerator<string>> {
  const llm = new ChatOpenAI({
    openAIApiKey: openaiApiKey,
    modelName: "gpt-4o-mini",
    temperature: 0.7,
    streaming: true,
  });

  // Define web search tool
  const tools = [
    new DynamicStructuredTool({
      name: "web_search",
      description:
        "Search the web for supporting information, recent updates, examples, statistics, or additional context to enhance your answer. Use this tool to find credible sources that support or expand on your response. Returns relevant articles with URLs that you should cite in your answer using markdown links.",
      schema: z.object({
        query: z.string().describe("The search query to find relevant supporting information, sources, or context"),
      }),
      func: async (input: { query: string }) => {
        const { query } = input;
        try {
          const tavilyApiKey = process.env.TAVILY_API_KEY || "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";
          
          const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              api_key: tavilyApiKey,
              query: query,
              search_depth: "basic",
              include_answer: true,
              max_results: 5,
            }),
          });

          if (!response.ok) {
            throw new Error(`Tavily API error: ${response.statusText}`);
          }

          const data = await response.json();
          
          let result = "WEB SEARCH RESULTS - Use these sources to support your answer with hyperlinks:\n\n";
          
          if (data.answer) {
            result += `Quick Answer: ${data.answer}\n\n`;
          }
          
          if (data.results && data.results.length > 0) {
            result += "SOURCES (cite these using markdown links):\n\n";
            data.results.forEach((item: any, index: number) => {
              result += `[${index + 1}] "${item.title}"\n`;
              result += `    Summary: ${item.content}\n`;
              result += `    URL: ${item.url}\n`;
              result += `    (Cite as: [${item.title}](${item.url}))\n\n`;
            });
          }
          
          return result || "No relevant information found.";
        } catch (error) {
          console.error("Web search error:", error);
          return `Unable to perform web search at this time.`;
        }
      },
    }),
    new DynamicStructuredTool({
      name: "generate_chart",
      description: `CRITICAL: Use this tool to create visual charts when users ask to "visualize", "show chart", "graph", or "see trends". 
      
WHEN TO USE (HIGH PRIORITY):
- User says "show", "visualize", "chart", "graph", or "display" with data
- Discussing trends over time (gold prices, stock prices, etc.)
- Comparing numerical values
- ANY question that would benefit from a visual representation

CHART TYPES:
- line: Time series, trends, historical data (e.g., price over years)
- bar: Compare categories or different items
- pie: Show percentages or proportions

IMPORTANT: When you have numerical data to show, USE THIS TOOL instead of just describing it in text!`,
      schema: z.object({
        type: z.enum(['line', 'bar', 'pie']).describe('Type of chart: line for trends over time, bar for comparisons, pie for proportions'),
        data: z.array(z.object({
          name: z.string().describe('Label for this data point (e.g., year, category)'),
          value: z.number().describe('Numerical value for this data point'),
        })).describe('Array of data points. Example: [{name: "2020", value: 1500}, {name: "2021", value: 1800}]'),
        title: z.string().describe('Title for the chart'),
        xKey: z.string().optional().describe('Key for X-axis (default: name)'),
        yKey: z.string().optional().describe('Key for Y-axis (default: value)'),
      }),
      func: async (input: any) => {
        const { type, data, title, xKey, yKey } = input;
        // Return a special marker that the frontend will recognize
        const chartData = {
          type,
          data,
          title: title || 'Data Visualization',
          xKey: xKey || 'name',
          yKey: yKey || 'value',
        };
        
        return `<CHART>${JSON.stringify(chartData)}</CHART>`;
      },
    }),
  ];

  const llmWithTools = llm.bindTools(tools);

  const systemPrompt = `You are an intelligent article assistant with web search AND data visualization capabilities.

PRIMARY MISSION:
1. Answer questions about the article content accurately and thoroughly
2. When users ask to "visualize", "show chart", "graph", or "display" data:
   - First: Gather data (from article or web_search if needed)
   - Then: IMMEDIATELY call generate_chart tool with that data
   - Finally: Explain the chart in your response
3. Incorporate web sources with proper attribution and hyperlinks
4. Always cite sources when using information from web search

**CRITICAL RULE FOR VISUALIZATIONS:**
If user says ANY of these words: "visualize", "show", "chart", "graph", "display", "plot", "trend"
→ You MUST call the generate_chart tool
→ Example data: [{name: "2020", value: 1500}, {name: "2021", value: 1800}, {name: "2022", value: 1900}]
→ DO NOT say "here is a chart" without actually calling the tool
→ If you mention a chart in your response, the chart MUST exist via generate_chart tool

WHEN TO USE WEB SEARCH:
- User asks questions that could benefit from recent data or updates
- User asks for examples, case studies, or real-world applications
- Questions about companies, people, or organizations mentioned in the article

**HOW TO CREATE CHARTS:**
Step 1: If user asks to visualize/chart/graph/show data:
Step 2: Extract or search for numerical data
Step 3: CALL generate_chart tool with:
   - type: "line" (for trends over time) or "bar" (for comparisons) or "pie" (for proportions)
   - data: Array of {name: string, value: number} objects
   - title: Descriptive title for the chart
Step 4: The tool returns <CHART>...</CHART> - include this EXACTLY in your response
Step 5: Add explanation text around the chart marker

Example correct flow:
User: "Show me gold prices over the years"
You: Call generate_chart({type: "line", data: [{name:"2020", value:1500}, ...], title: "Gold Prices"})
You: "Here are the gold price trends: <CHART>...</CHART> As you can see..."

WRONG (DO NOT DO THIS):
"Here is a chart representing..." ← NO! You must CALL the tool, not describe it!

HOW TO USE WEB SEARCH RESULTS:
1. Search for relevant information to support your answer
2. Integrate findings naturally into your response
3. Always include hyperlinks to sources in markdown format: [Source Name](URL)
4. Provide context about where the information came from
5. If search yields no results, answer from article knowledge only

RESPONSE FORMAT:
- Start with a direct answer to the question
- Support with details from the article
- Enhance with web-searched information when relevant
- Always include clickable links to sources
- Keep responses clear, concise, and well-structured

Current Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

Article: "${articleTitle}"

Summary:
${articleSummary || "Not available"}

Full Article:
${articleContent.slice(0, 3000)}${articleContent.length > 3000 ? "..." : ""}

Remember: Use web_search proactively to provide comprehensive, well-sourced answers with hyperlinks.`;

  // Check if the last user message contains visualization keywords
  const lastUserMessage = messages[messages.length - 1];
  const visualizationKeywords = ['visualize', 'show', 'chart', 'graph', 'display', 'plot', 'trend'];
  const needsVisualization = lastUserMessage && 
    lastUserMessage.role === 'user' && 
    visualizationKeywords.some(keyword => lastUserMessage.content.toLowerCase().includes(keyword));

  const formattedMessages = [
    new SystemMessage(systemPrompt),
    ...messages.map((m, index) => {
      if (m.role === "user") {
        // If this is the last message and needs visualization, add explicit reminder
        if (index === messages.length - 1 && needsVisualization) {
          return new HumanMessage(
            `${m.content}\n\n[SYSTEM NOTE: User wants a visual chart/graph. After gathering data, you MUST use generate_chart tool with the data to create the visualization. Do not just describe it - actually call the tool!]`
          );
        }
        return new HumanMessage(m.content);
      }
      return new AIMessage(m.content);
    }),
  ];

  return (async function* () {
    try {
      console.log("[Agent] Starting with", formattedMessages.length, "messages");
      
      // STEP 1: Use invoke() to get the complete response and check for tool calls
      const initialResponse = await llmWithTools.invoke(formattedMessages);
      const hasToolCalls = initialResponse.tool_calls && initialResponse.tool_calls.length > 0;
      
      console.log(`[Agent] Initial response: ${String(initialResponse.content).length} chars, ${hasToolCalls ? initialResponse.tool_calls!.length : 0} tool calls`);

      // STEP 2: If there are tool calls, execute them
      if (hasToolCalls && initialResponse.tool_calls) {
        yield "🔍 Searching the web...\n\n";
        
        // Execute all tools
        const toolResults: Array<{ id: string; content: string }> = [];
        
        for (const toolCall of initialResponse.tool_calls) {
          const tool = tools.find(t => t.name === toolCall.name);
          if (tool && toolCall.id) {
            try {
              console.log(`[Agent] Executing ${toolCall.name} with args:`, JSON.stringify(toolCall.args).substring(0, 100));
              const toolResult = await tool.func(toolCall.args as any);
              
              // For web search, add instructions about chart generation if it's a visualization request
              let enhancedToolResult = toolCall.name === 'generate_chart' 
                ? toolResult 
                : `${toolResult}\n\nIMPORTANT: Integrate these sources into your response using markdown hyperlinks. Format links as [Title](URL). Cite sources naturally within your answer.`;
              
              // If this is web search and we have numerical data, remind about chart generation
              if (toolCall.name === 'web_search' && toolResult.match(/\d{4}.*?\$?\d{1,3}[,\d]*\.?\d*/)) {
                enhancedToolResult += `\n\nNOTE: You have numerical data. If user asked to visualize/show/chart/graph this data, you MUST now call the generate_chart tool with this data formatted as [{name: "year", value: number}, ...].`;
              }
              
              toolResults.push({ id: toolCall.id, content: enhancedToolResult });
            } catch (error) {
              console.error("[Agent] Tool execution failed:", error);
              toolResults.push({ id: toolCall.id, content: "Search failed. Please try rephrasing your question." });
            }
          }
        }
        
        // Build messages with tool results
        const messagesWithToolResults = [
          ...formattedMessages,
          new AIMessage({
            content: String(initialResponse.content || ""),
            additional_kwargs: {
              tool_calls: initialResponse.tool_calls.map((tc: any) => ({
                id: tc.id,
                type: "function" as const,
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.args),
                },
              })),
            },
          }),
          ...toolResults.map(result => ({
            role: "tool" as const,
            content: result.content,
            tool_call_id: result.id,
          } as any)),
        ];
        
        // STEP 3: Get response with tool results - LLM might want to make MORE tool calls (like generate_chart)
        console.log("[Agent] Getting response with tool results...");
        const secondResponse = await llmWithTools.invoke(messagesWithToolResults);
        
        // Check if there are MORE tool calls (e.g., chart generation after web search)
        if (secondResponse.tool_calls && secondResponse.tool_calls.length > 0) {
          console.log(`[Agent] Found ${secondResponse.tool_calls.length} additional tool calls:`, secondResponse.tool_calls.map(tc => tc.name));
          console.log(`[Agent] Available tools:`, tools.map(t => t.name));
          
          // Execute the additional tools (e.g., generate_chart)
          const additionalToolResults: Array<{ id: string; content: string }> = [];
          
          for (const toolCall of secondResponse.tool_calls) {
            const tool = tools.find(t => t.name === toolCall.name);
            if (tool && toolCall.id) {
              try {
                console.log(`[Agent] Executing ${toolCall.name} with args:`, JSON.stringify(toolCall.args).substring(0, 200));
                const toolResult = await tool.func(toolCall.args as any);
                const enhancedToolResult = toolCall.name === 'generate_chart' 
                  ? toolResult 
                  : `${toolResult}\n\nIMPORTANT: Integrate these sources into your response using markdown hyperlinks.`;
                additionalToolResults.push({ id: toolCall.id, content: enhancedToolResult });
              } catch (error) {
                console.error("[Agent] Tool execution failed:", error);
                additionalToolResults.push({ id: toolCall.id, content: "Tool execution failed." });
              }
            }
          }
          
          // Build final messages with ALL tool results
          const finalMessages = [
            ...messagesWithToolResults,
            new AIMessage({
              content: String(secondResponse.content || ""),
              additional_kwargs: {
                tool_calls: secondResponse.tool_calls.map((tc: any) => ({
                  id: tc.id,
                  type: "function" as const,
                  function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.args),
                  },
                })),
              },
            }),
            ...additionalToolResults.map(result => ({
              role: "tool" as const,
              content: result.content,
              tool_call_id: result.id,
            } as any)),
          ];
          
          // Stream final response with ALL tool results
          console.log("[Agent] Streaming final response with all tools...");
          const finalStream = await llm.stream(finalMessages);
          
          for await (const chunk of finalStream) {
            if (chunk.content) {
              const content = String(chunk.content);
              if (content) {
                yield content;
              }
            }
          }
        } else {
          // No additional tools needed, stream the response
          console.log("[Agent] Streaming final response...");
          const finalStream = await llm.stream(messagesWithToolResults);
          
          for await (const chunk of finalStream) {
            if (chunk.content) {
              const content = String(chunk.content);
              if (content) {
                yield content;
              }
            }
          }
        }
      } else {
        // STEP 4: No tool calls - stream the response directly
        console.log("[Agent] No tools needed, streaming response...");
        const stream = await llm.stream(formattedMessages);
        
        for await (const chunk of stream) {
          if (chunk.content) {
            const content = String(chunk.content);
            if (content) {
              yield content;
            }
          }
        }
      }
      
      console.log("[Agent] Stream complete");
    } catch (error) {
      console.error("[Agent] Error:", error);
      yield "\n\nSorry, I encountered an error processing your request.";
    }
  })();
}

/**
 * Generate suggested questions for an article
 */
export async function generateSuggestedQuestions(
  articleContent: string,
  articleTitle: string,
  openaiApiKey: string
): Promise<string[]> {
  const llm = new ChatOpenAI({
    openAIApiKey: openaiApiKey,
    modelName: "gpt-4o-mini",
    temperature: 0.7,
  });

  const systemPrompt = `
You are an AI specialized in crafting insightful and engaging questions about articles. 
Your task is to analyze the article title and content, then generate **exactly 4 natural and thought-provoking questions** that a curious reader might ask after reading it.

Guidelines:
1. Questions must be **directly based on the article content** — avoid speculation unrelated to it.
2. Each question should be **specific, meaningful, and reflective of key ideas, facts, or implications** from the article.
3. Avoid generic or shallow questions (e.g., "What is this article about?" or "Why is this important?").
4. Use **natural, conversational language** — as if you’re engaging in a discussion about the article.
5. Focus on what a reader would genuinely want to know more about (causes, effects, motivations, consequences, etc.).

Input:
- **Article Title:** "${articleTitle}"
- **Article Content:** 
${articleContent.slice(0, 3000)}${articleContent.length > 30000 ? "..." : ""}

Output:
Write **exactly 4 questions**, one per line, with no numbering or bullet points.
Only output the questions — no explanations or extra text.
`;


  const response = await llm.invoke([new SystemMessage(systemPrompt)]);

  // Parse the response into an array of questions
  const questions = (response.content as string)
    .split("\n")
    .map((q) => q.trim())
    .filter((q) => q.length > 0 && q.endsWith("?"))
    .slice(0, 4); // Ensure max 4 questions

  return questions;
}

/**
 * Generate contextual follow-up questions based on conversation history
 */
export async function generateFollowUpQuestions(
  conversationHistory: { role: string; content: string }[],
  articleContent: string,
  articleTitle: string,
  openaiApiKey: string
): Promise<string[]> {
  const llm = new ChatOpenAI({
    openAIApiKey: openaiApiKey,
    modelName: "gpt-4o-mini",
    temperature: 0.8,
  });

  // Get last few exchanges
  const recentConversation = conversationHistory
    .slice(-6) // Last 3 exchanges (user + assistant)
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join("\n");

  const systemPrompt = `
You are an AI that crafts **contextual follow-up questions** to naturally continue a discussion.
Analyze the article and the recent conversation, then write **exactly 3** focused questions that move the dialogue forward.

Objective:
- Build directly on what the user and assistant already discussed.
- Tie those points back to key details/implications in the article.

Rules:
1) Ground every question in **both** the conversation context and the article (no off-topic speculation).
2) Go deeper on **partially explored** ideas, unresolved points, or consequences the user seems interested in.
3) Connect related parts of the article (e.g., causes ↔ effects, data ↔ claims, policy ↔ impact).
4) Keep wording **natural and conversational**; prefer open-ended forms (what/how/why).
5) **Do not** repeat or lightly rephrase questions already asked in the conversation.
6) Keep each question concise (aim ≤ 22 words), and avoid yes/no questions unless they clearly invite elaboration.
7) Use the user’s terminology and named entities from the conversation when relevant.

Inputs:
- Article Title: "${articleTitle}"
- Article Content:
${articleContent?.slice?.(0, 4000) ?? ""}${articleContent && articleContent.length > 4000 ? " ..." : ""}
- Recent Conversation (most recent first):
${recentConversation}

Output format:
- **Exactly 3 questions**
- One per line
- **No numbering, no bullets, no extra text**
`;


  try {
    const response = await llm.invoke([new SystemMessage(systemPrompt)]);

    // Parse the response into an array of questions
    const questions = (response.content as string)
      .split("\n")
      .map((q) => q.trim())
      .filter((q) => q.length > 0 && q.endsWith("?"))
      .slice(0, 3);

    return questions;
  } catch (error) {
    console.error("Error generating follow-up questions:", error);
    return []; // Return empty array on error
  }
}
