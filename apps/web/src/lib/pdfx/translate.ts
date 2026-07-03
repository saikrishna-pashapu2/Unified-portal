import OpenAI from 'openai';
import { env } from "@/lib/config/env";

const client = new OpenAI({
  apiKey: env.OPENAI_API_KEY!,
});

function cleanTranslation(s: string) {
  // strip common wrappers
  let out = (s || '').trim();
  out = out.replace(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/m, '$1').trim();
  out = out.replace(/^(here is (the )?translation:?|translation:)\s*/i, '').trim();
  return out;
}

export async function translatePage(
  text: string,
  targetLang: string
): Promise<string> {
  if (!text || !text.trim()) return '';

  const messages = [
    {
      role: 'system' as const,
      content:
        `You are a professional translator to ${targetLang}. ` +
        `RULES: Output ONLY the translated text (no preface or commentary). ` +
        `Preserve line breaks and paragraph structure exactly. ` +
        `Never add headings.`,
    },
    {
      role: 'user' as const,
      content: text,
    },
  ];

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 4000,
    messages,
  });

  const raw = resp.choices[0]?.message?.content || '';
  return cleanTranslation(raw);
}
