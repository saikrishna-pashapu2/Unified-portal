import OpenAI from "openai";
import { env } from "@/lib/config/env";

export const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY!,
  organization: env.OPENAI_ORG_ID,
});

export async function translateChunk(text: string, targetLang: string) {
  if (!text?.trim()) return "";
  const prompt = [
    {
      role: "system" as const,
      content:
        `You are a professional document translator. Rules:
- Output ONLY the translated text, no comments
- Preserve formatting, line breaks and paragraph structure
- Keep ordered/bulleted lists and numbering
- Translate to ${targetLang}
- If text is unclear, translate it as best as possible`,
    },
    { role: "user" as const, content: text },
  ];
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: prompt,
    temperature: 0.2,
    max_tokens: 4000,
  });
  return (res.choices?.[0]?.message?.content || "").trim();
}
