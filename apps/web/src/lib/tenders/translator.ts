/**
 * Tender Translation Service
 * Translates tender content from Russian/Kazakh to English using OpenAI
 */

import OpenAI from 'openai';
import { env } from "@/lib/config/env";

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

interface TranslationInput {
  title: string;
  description?: string;
  additionalInfo?: string;
  deliveryTerms?: string;
  status?: string;
}

interface TranslationResult {
  title: string;
  description?: string;
  additionalInfo?: string;
  deliveryTerms?: string;
  status?: string;
  cost?: number;
  timeMs?: number;
}

/**
 * Translate tender content to English
 */
export async function translateTender(input: TranslationInput): Promise<TranslationResult> {
  const startTime = Date.now();

  console.log('[Tender Translator] Starting translation...');

  try {
    // Build translation prompt
    const content = buildTranslationContent(input);

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a professional translator specializing in government procurement and tender documents. 
Translate the following tender information from Russian/Kazakh to English.
Maintain technical terms and acronyms where appropriate.
Return ONLY a JSON object with the translated fields, no additional text.`,
        },
        {
          role: 'user',
          content,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const timeMs = Date.now() - startTime;

    // Parse response
    const translated = JSON.parse(response.choices[0].message.content || '{}');

    // Calculate cost (approximate)
    const promptTokens = response.usage?.prompt_tokens || 0;
    const completionTokens = response.usage?.completion_tokens || 0;
    const cost = calculateCost(promptTokens, completionTokens);

    console.log(`[Tender Translator] Translation completed in ${timeMs}ms (cost: $${cost.toFixed(6)})`);

    return {
      title: translated.title || input.title,
      description: translated.description,
      additionalInfo: translated.additionalInfo,
      deliveryTerms: translated.deliveryTerms,
      status: translated.status,
      cost,
      timeMs,
    };
  } catch (error) {
    console.error('[Tender Translator] Translation failed:', error);
    
    // Fallback to original text
    return {
      title: input.title,
      description: input.description,
      additionalInfo: input.additionalInfo,
      deliveryTerms: input.deliveryTerms,
      status: input.status,
      cost: 0,
      timeMs: Date.now() - startTime,
    };
  }
}

/**
 * Build translation content for OpenAI
 */
function buildTranslationContent(input: TranslationInput): string {
  const parts: string[] = [];

  parts.push(`Translate the following tender information to English:\n`);
  parts.push(`{\n`);
  parts.push(`  "title": "${escapeJson(input.title)}"`);

  if (input.description) {
    parts.push(`,\n  "description": "${escapeJson(input.description)}"`);
  }

  if (input.additionalInfo) {
    parts.push(`,\n  "additionalInfo": "${escapeJson(input.additionalInfo)}"`);
  }

  if (input.deliveryTerms) {
    parts.push(`,\n  "deliveryTerms": "${escapeJson(input.deliveryTerms)}"`);
  }

  if (input.status) {
    parts.push(`,\n  "status": "${escapeJson(input.status)}"`);
  }

  parts.push(`\n}`);

  return parts.join('');
}

/**
 * Escape JSON special characters
 */
function escapeJson(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Calculate OpenAI API cost
 * GPT-4o-mini pricing (as of 2024):
 * - Input: $0.150 per 1M tokens
 * - Output: $0.600 per 1M tokens
 */
function calculateCost(promptTokens: number, completionTokens: number): number {
  const inputCost = (promptTokens / 1_000_000) * 0.15;
  const outputCost = (completionTokens / 1_000_000) * 0.6;
  return inputCost + outputCost;
}
