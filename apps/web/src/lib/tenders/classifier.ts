/**
 * Tender Classification Service
 * Uses LLM to classify tenders into ESG/Credit domains based on keywords
 */

import OpenAI from 'openai';
import { esgPrisma as db } from '@esgcredit/db-esg';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ClassificationResult {
  esgScore: number;
  creditScore: number;
  primaryDomain: 'esg' | 'credit' | 'both' | 'neither';
  reasoning: string;
  esgKeywords: string[];
  creditKeywords: string[];
  cost: number;
  timeMs: number;
}

/**
 * Classify a tender into ESG/Credit domains
 */
export async function classifyTender(tenderId: number): Promise<ClassificationResult> {
  const startTime = Date.now();

  console.log(`[Tender Classifier] Starting classification for tender ${tenderId}...`);

  try {
    // Get tender data
    const tender = await db.tenders.findUnique({
      where: { id: tenderId },
      select: {
        id: true,
        title: true,
        description: true,
        additional_info: true,
        procurement_method: true,
        customer_name: true,
      },
    });

    if (!tender) {
      throw new Error(`Tender not found: ${tenderId}`);
    }

    // Get domain keywords
    const keywords = await db.domain_keywords.findMany({
      where: { is_active: true },
      select: {
        domain: true,
        keyword: true,
        category: true,
        weight: true,
      },
    });

    const esgKeywords = keywords.filter((k: any) => k.domain === 'esg').map((k: any) => k.keyword);
    const creditKeywords = keywords.filter((k: any) => k.domain === 'credit').map((k: any) => k.keyword);

    // Build classification prompt
    const prompt = buildClassificationPrompt(tender, esgKeywords, creditKeywords);

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an expert in ESG (Environmental, Social, Governance) and Credit Rating analysis.
Analyze the tender and classify it into domains based on the provided keywords.
Return your analysis as a JSON object with the following structure:
{
  "esgScore": 0.0-1.0,
  "creditScore": 0.0-1.0,
  "primaryDomain": "esg" | "credit" | "both" | "neither",
  "reasoning": "Brief explanation",
  "esgKeywords": ["matched", "keywords"],
  "creditKeywords": ["matched", "keywords"]
}`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const timeMs = Date.now() - startTime;

    // Parse response
    const classification = JSON.parse(response.choices[0].message.content || '{}');

    // Calculate cost
    const promptTokens = response.usage?.prompt_tokens || 0;
    const completionTokens = response.usage?.completion_tokens || 0;
    const cost = calculateCost(promptTokens, completionTokens);

    const result: ClassificationResult = {
      esgScore: classification.esgScore || 0,
      creditScore: classification.creditScore || 0,
      primaryDomain: classification.primaryDomain || 'neither',
      reasoning: classification.reasoning || '',
      esgKeywords: classification.esgKeywords || [],
      creditKeywords: classification.creditKeywords || [],
      cost,
      timeMs,
    };

    console.log(`[Tender Classifier] Classification completed in ${timeMs}ms:`, {
      tenderId,
      primaryDomain: result.primaryDomain,
      esgScore: result.esgScore,
      creditScore: result.creditScore,
      cost: `$${cost.toFixed(6)}`,
    });

    // Save classification to database
    await db.tender_classifications.create({
      data: {
        tender_id: tenderId,
        esg_score: result.esgScore,
        credit_score: result.creditScore,
        primary_domain: result.primaryDomain,
        reasoning: result.reasoning,
        esg_keywords: result.esgKeywords,
        credit_keywords: result.creditKeywords,
        model_used: 'gpt-4o-mini',
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        classification_cost: cost,
        processing_time_ms: timeMs,
      },
    });

    // Update tender with classification
    await db.tenders.update({
      where: { id: tenderId },
      data: {
        primary_domain: result.primaryDomain,
        domain_classification: {
          esg: result.esgScore,
          credit: result.creditScore,
        },
        matched_keywords: {
          esg: result.esgKeywords,
          credit: result.creditKeywords,
        },
        ai_summary: result.reasoning,
        classification_date: new Date(),
        classification_confidence: Math.max(result.esgScore, result.creditScore),
      },
    });

    return result;

  } catch (error) {
    console.error(`[Tender Classifier] Classification failed for tender ${tenderId}:`, error);
    throw error;
  }
}

/**
 * Build classification prompt
 */
function buildClassificationPrompt(
  tender: any,
  esgKeywords: string[],
  creditKeywords: string[]
): string {
  return `Analyze this government procurement tender and classify it into domains:

TENDER INFORMATION:
Title: ${tender.title}
Description: ${tender.description || 'N/A'}
Additional Info: ${tender.additional_info || 'N/A'}
Procurement Method: ${tender.procurement_method || 'N/A'}
Customer: ${tender.customer_name || 'N/A'}

ESG KEYWORDS (Environmental, Social, Governance):
${esgKeywords.join(', ')}

CREDIT KEYWORDS (Financial, Credit Rating, Risk):
${creditKeywords.join(', ')}

INSTRUCTIONS:
1. Analyze the tender content
2. Check for keyword matches (be flexible with variations and related terms)
3. Assign confidence scores (0.0-1.0) for ESG and Credit relevance
4. Determine primary domain:
   - "esg" if ESG score > 0.6 and > Credit score
   - "credit" if Credit score > 0.6 and > ESG score
   - "both" if both scores > 0.6
   - "neither" if both scores < 0.6
5. List the matched keywords found in the content
6. Provide brief reasoning for your classification

Return ONLY the JSON object, no additional text.`;
}

/**
 * Calculate OpenAI API cost
 */
function calculateCost(promptTokens: number, completionTokens: number): number {
  const inputCost = (promptTokens / 1_000_000) * 0.15;
  const outputCost = (completionTokens / 1_000_000) * 0.6;
  return inputCost + outputCost;
}

/**
 * Batch classify all unclassified tenders
 */
export async function classifyUnclassifiedTenders(): Promise<void> {
  console.log('[Tender Classifier] Finding unclassified tenders...');

  const unclassified = await db.tenders.findMany({
    where: {
      primary_domain: null,
    },
    select: { id: true },
    take: 50, // Process in batches
  });

  console.log(`[Tender Classifier] Found ${unclassified.length} unclassified tenders`);

  for (const tender of unclassified) {
    try {
      await classifyTender(tender.id);
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`[Tender Classifier] Failed to classify tender ${tender.id}:`, error);
    }
  }

  console.log('[Tender Classifier] Batch classification completed');
}
