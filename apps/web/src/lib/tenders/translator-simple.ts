/**
 * Simple Tender Translator
 * Translates tender content from Russian/Kazakh to English
 * No classification - these are all ESG domain by default
 */

import OpenAI from 'openai';
import { env } from "@/lib/config/env";

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

interface TenderInput {
  title: string;
  description?: string;
  additionalInfo?: string;
  deliveryTerms?: string;
  procurementMethod?: string;
  procurementType?: string;
  status?: string;
  customerName?: string;
}

interface TranslatedTender {
  title: string;
  description: string | null;
  additionalInfo: string | null;
  deliveryTerms: string | null;
  procurementMethod: string | null;
  procurementType: string | null;
  status: string | null;
  customerName: string | null;
  cost: number;
  timeMs: number;
  tokens: {
    prompt: number;
    completion: number;
  };
}

export async function translateTender(input: TenderInput): Promise<TranslatedTender> {
  const startTime = Date.now();

  const prompt = `Translate the following tender information from Russian/Kazakh to English. 
Provide clear, professional translations. If a field is empty or "N/A", return null for that field.

Tender Information:
- Title: ${input.title}
- Description: ${input.description || 'N/A'}
- Additional Info: ${input.additionalInfo || 'N/A'}
- Delivery Terms: ${input.deliveryTerms || 'N/A'}
- Procurement Method: ${input.procurementMethod || 'N/A'}
- Procurement Type: ${input.procurementType || 'N/A'}
- Status: ${input.status || 'N/A'}
- Customer Name: ${input.customerName || 'N/A'}

Return the translations in JSON format:
{
  "title": "translated title",
  "description": "translated description or null",
  "additionalInfo": "translated additional info or null",
  "deliveryTerms": "translated delivery terms or null",
  "procurementMethod": "translated procurement method or null",
  "procurementType": "translated procurement type or null",
  "status": "translated status or null",
  "customerName": "translated customer name or null"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a professional translator specializing in government procurement documents. Translate from Russian/Kazakh to English accurately and professionally.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content || '{}';
    const translated = JSON.parse(content);

    const timeMs = Date.now() - startTime;
    const promptTokens = response.usage?.prompt_tokens || 0;
    const completionTokens = response.usage?.completion_tokens || 0;

    // Calculate cost (gpt-4o-mini pricing)
    const inputCost = (promptTokens / 1_000_000) * 0.15; // $0.15 per 1M input tokens
    const outputCost = (completionTokens / 1_000_000) * 0.60; // $0.60 per 1M output tokens
    const totalCost = inputCost + outputCost;

    console.log(`[Translator] Translated tender in ${timeMs}ms. Cost: $${totalCost.toFixed(6)}`);

    return {
      title: translated.title || input.title,
      description: translated.description || null,
      additionalInfo: translated.additionalInfo || null,
      deliveryTerms: translated.deliveryTerms || null,
      procurementMethod: translated.procurementMethod || null,
      procurementType: translated.procurementType || null,
      status: translated.status || null,
      customerName: translated.customerName || null,
      cost: totalCost,
      timeMs,
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
      },
    };
  } catch (error) {
    console.error('[Translator] Error translating tender:', error);
    
    // Return original values on error
    return {
      title: input.title,
      description: input.description || null,
      additionalInfo: input.additionalInfo || null,
      deliveryTerms: input.deliveryTerms || null,
      procurementMethod: input.procurementMethod || null,
      procurementType: input.procurementType || null,
      status: input.status || null,
      customerName: input.customerName || null,
      cost: 0,
      timeMs: Date.now() - startTime,
      tokens: {
        prompt: 0,
        completion: 0,
      },
    };
  }
}
