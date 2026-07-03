/**
 * API Route: Article Assistant Chat
 * POST /api/article-assistant/chat
 * 
 * Handles user messages with streaming responses
 */

import { NextRequest } from "next/server";
import { requireSession, unauthorized } from "@/lib/api-auth";
import { env } from "@/lib/config/env";
import { getPrisma } from "@/lib/db";
import { encoding_for_model } from "tiktoken";
import {
  getConversationBySessionId,
  addMessage,
  getConversationHistory,
  updateConversationCost,
  recordToolCall,
} from "@/lib/article-assistant-db";
import { streamArticleChat, generateFollowUpQuestions } from "@/lib/article-assistant-agent";
import { recordUserActivity } from "@/lib/user-activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Token counting helper
function countTokens(text: string, model: string = "gpt-4o-mini"): number {
  try {
    const encoding = encoding_for_model(model as any);
    const tokens = encoding.encode(text);
    const count = tokens.length;
    encoding.free();
    return count;
  } catch (error) {
    // Fallback: rough estimate (1 token ≈ 4 characters)
    return Math.ceil(text.length / 4);
  }
}

// Cost calculation helper for gpt-4o-mini
// Pricing: $0.150 per 1M input tokens, $0.600 per 1M output tokens
function calculateCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1000000) * 0.150;
  const outputCost = (outputTokens / 1000000) * 0.600;
  return inputCost + outputCost;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.response) return auth.response;

    const userId = Number((auth.session.user as any).id);
    if (!Number.isFinite(userId)) {
      return unauthorized();
    }

    const body = await request.json();
    const { sessionId, message, domain } = body;

    if (!sessionId || !message || !domain) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (domain !== "esg" && domain !== "credit") {
      return new Response(
        JSON.stringify({ error: "Invalid domain" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get conversation
    const conversation = await getConversationBySessionId(domain, sessionId);

    if (!conversation) {
      return new Response(
        JSON.stringify({ error: "Conversation not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    if (conversation.user_id !== userId) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch article content
    const prisma = getPrisma(domain);
    let article: any = null;

    if (domain === "credit") {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, title, content
        FROM credit_articles
        WHERE id = ${conversation.article_id}
        LIMIT 1
      `;
      article = rows[0] || null;
    } else {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, title, summary as content
        FROM esg_articles
        WHERE id = ${conversation.article_id}
        LIMIT 1
      `;
      article = rows[0] || null;
    }

    if (!article) {
      return new Response(
        JSON.stringify({ error: "Article not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Add user message to database
    const userTokens = countTokens(message);
    await addMessage(domain, conversation.id, "user", message, userTokens);

    // Get conversation history
    const history = await getConversationHistory(domain, conversation.id, 10);

    // Get OpenAI key
    const openaiKey = env.OPENAI_API_KEY;
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log("[Chat] Starting stream...");
          
          // Stream the response
          const responseStream = await streamArticleChat(
            history,
            article.content || "",
            article.title || "Untitled",
            conversation.article_summary,
            openaiKey,
            async (toolEvent) => {
              await recordToolCall(
                domain,
                conversation.id,
                toolEvent.toolName,
                toolEvent.toolInput,
                toolEvent.toolOutput,
                toolEvent.status,
                toolEvent.executionTimeMs,
                toolEvent.errorMessage
              );

              if (conversation.user_id) {
                await recordUserActivity({
                  userId: conversation.user_id,
                  action: "use_tool",
                  resourceType: "tool",
                  details: `${toolEvent.toolName} on /${domain}/articles/${conversation.article_id}`,
                });
              }
            }
          );

          console.log("[Chat] Got response stream");
          let fullResponse = "";
          let chunkCount = 0;

          try {
            for await (const chunk of responseStream) {
              chunkCount++;
              fullResponse += chunk;
              const data = JSON.stringify({ chunk });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          } catch (streamError) {
            console.error("[Chat] Error during streaming:", streamError);
            throw streamError;
          }

          console.log(`[Chat] Stream complete: ${chunkCount} chunks, ${fullResponse.length} chars`);

          // Remove search indicator before saving to database
          const cleanResponse = fullResponse.replace(/🔍 Searching the web\.\.\.\n\n/g, '').trim();

          // Count tokens for assistant response
          const assistantTokens = countTokens(cleanResponse);
          
          // Save assistant response to database
          await addMessage(domain, conversation.id, "assistant", cleanResponse, assistantTokens);

          // Calculate cost and update conversation
          // Input tokens = user message + system prompt + article content + history (approximate)
          const systemPromptApprox = 800; // Rough estimate of system prompt tokens
          const articleContentTokens = countTokens(article.content || "");
          const historyTokens = history.reduce((sum, msg) => sum + countTokens(msg.content), 0);
          const inputTokens = userTokens + systemPromptApprox + articleContentTokens + historyTokens;
          const outputTokens = assistantTokens;
          const cost = calculateCost(inputTokens, outputTokens);
          
          // Update conversation with tokens and cost
          await updateConversationCost(domain, conversation.id, inputTokens + outputTokens, cost);
          
          console.log(`[Chat] Tokens - Input: ${inputTokens}, Output: ${outputTokens}, Total: ${inputTokens + outputTokens}, Cost: $${cost.toFixed(6)}`);

          // Generate follow-up questions (don't await - run in background)
          let followUpQuestions: string[] = [];
          try {
            const updatedHistory = await getConversationHistory(domain, conversation.id, 10);
            followUpQuestions = await generateFollowUpQuestions(
              updatedHistory,
              article.content || "",
              article.title || "Untitled",
              openaiKey
            );
          } catch (error) {
            console.error("Error generating follow-up questions:", error);
            followUpQuestions = [];
          }

          // Send follow-up questions
          if (followUpQuestions.length > 0) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ followUpQuestions })}\n\n`)
            );
          }

          // Send done signal
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
        } catch (error) {
          console.error("Streaming error:", error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "Stream error" })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error in chat:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process chat" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
