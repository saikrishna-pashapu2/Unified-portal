/**
 * Combined Translation and Classification Service
 * Single GPT call to translate Russian/Kazakh → English AND classify into ESG/Credit domains
 */

import OpenAI from 'openai';
import { esgPrisma as db } from '@esgcredit/db-esg';
import { env } from "@/lib/config/env";

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

interface TenderInput {
  title: string;
  description?: string;
  additionalInfo?: string;
  deliveryTerms?: string;
  status?: string;
  customerName?: string;
  procurementMethod?: string;
}

interface ProcessedTender {
  // Translated content
  title: string;
  description?: string;
  additionalInfo?: string;
  deliveryTerms?: string;
  status?: string;
  
  // Classification
  primaryDomain: 'esg' | 'credit' | 'both' | 'neither';
  esgScore: number;
  creditScore: number;
  reasoning: string;
  esgKeywords: string[];
  creditKeywords: string[];
  
  // Metadata
  cost: number;
  timeMs: number;
  tokens: {
    prompt: number;
    completion: number;
  };
}

/**
 * Process tender: Translate AND Classify in one GPT call
 */
export async function processAndClassifyTender(input: TenderInput): Promise<ProcessedTender> {
  const startTime = Date.now();

  console.log('[Tender Processor] Starting translation and classification...');

  try {
    // Get domain keywords from database
    const keywords = await db.domain_keywords.findMany({
      where: { is_active: true, language: 'en' },
      select: {
        domain: true,
        keyword: true,
        weight: true,
      },
    });

    const esgKeywords = keywords.filter((k: any) => k.domain === 'esg').map((k: any) => k.keyword);
    const creditKeywords = keywords.filter((k: any) => k.domain === 'credit').map((k: any) => k.keyword);

    // Build comprehensive prompt
    const prompt = buildCombinedPrompt(input, esgKeywords, creditKeywords);

    // Single GPT call
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a professional translator and ESG/Credit analyst for government procurement.

Your task:
1. Translate the tender from Russian/Kazakh to English
2. Classify it into ESG (Environmental, Social, Governance) or Credit domains
3. Return a JSON object with translated content AND classification

Be accurate, maintain technical terms, and provide confidence scores.`,
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
    const result = JSON.parse(response.choices[0].message.content || '{}');

    // Calculate cost
    const promptTokens = response.usage?.prompt_tokens || 0;
    const completionTokens = response.usage?.completion_tokens || 0;
    const cost = calculateCost(promptTokens, completionTokens);

    console.log(`[Tender Processor] Completed in ${timeMs}ms (cost: $${cost.toFixed(6)})`);

    return {
      title: result.title || input.title,
      description: result.description,
      additionalInfo: result.additionalInfo,
      deliveryTerms: result.deliveryTerms,
      status: result.status,
      
      primaryDomain: result.primaryDomain || 'neither',
      esgScore: result.esgScore || 0,
      creditScore: result.creditScore || 0,
      reasoning: result.reasoning || '',
      esgKeywords: result.esgKeywords || [],
      creditKeywords: result.creditKeywords || [],
      
      cost,
      timeMs,
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
      },
    };

  } catch (error) {
    console.error('[Tender Processor] Processing failed:', error);
    
    // Fallback to original text
    return {
      title: input.title,
      description: input.description,
      additionalInfo: input.additionalInfo,
      deliveryTerms: input.deliveryTerms,
      status: input.status,
      
      primaryDomain: 'neither',
      esgScore: 0,
      creditScore: 0,
      reasoning: 'Processing failed',
      esgKeywords: [],
      creditKeywords: [],
      
      cost: 0,
      timeMs: Date.now() - startTime,
      tokens: { prompt: 0, completion: 0 },
    };
  }
}

/**
 * Build combined translation + classification prompt
 */
function buildCombinedPrompt(
  input: TenderInput,
  esgKeywords: string[],
  creditKeywords: string[]
): string {
  return `Analyze this government procurement tender. Translate it to English AND classify it into domains.

TENDER DATA (Russian/Kazakh):
${JSON.stringify({
  title: input.title,
  description: input.description || 'N/A',
  additionalInfo: input.additionalInfo || 'N/A',
  deliveryTerms: input.deliveryTerms || 'N/A',
  status: input.status || 'N/A',
  customerName: input.customerName || 'N/A',
  procurementMethod: input.procurementMethod || 'N/A',
}, null, 2)}

ESG KEYWORDS (Environmental, Social, Governance):
${esgKeywords.join(', ')}

CREDIT KEYWORDS (Financial, Rating, Risk):
${creditKeywords.join(', ')}

INSTRUCTIONS:
1. Translate ALL fields from Russian/Kazakh to English
2. Analyze content for ESG and Credit relevance
3. Match keywords (be flexible - consider variations and related terms)
4. Assign confidence scores (0.0-1.0) for ESG and Credit
5. Determine primary domain:
   - "esg" if ESG score > 0.6 and > Credit score
   - "credit" if Credit score > 0.6 and > ESG score
   - "both" if both scores > 0.6
   - "neither" if both scores < 0.6

Return ONLY this JSON structure:
{
  "title": "Translated title in English",
  "description": "Translated description",
  "additionalInfo": "Translated additional info",
  "deliveryTerms": "Translated delivery terms",
  "status": "Translated status (e.g., Published, Completed)",
  "esgScore": 0.0,
  "creditScore": 0.0,
  "primaryDomain": "esg|credit|both|neither",
  "reasoning": "Brief explanation of classification",
  "esgKeywords": ["matched", "keywords"],
  "creditKeywords": ["matched", "keywords"]
}`;
}

/**
 * Calculate OpenAI API cost
 * GPT-4o-mini pricing: $0.150/1M input, $0.600/1M output
 */
function calculateCost(promptTokens: number, completionTokens: number): number {
  const inputCost = (promptTokens / 1_000_000) * 0.15;
  const outputCost = (completionTokens / 1_000_000) * 0.6;
  return inputCost + outputCost;
}
