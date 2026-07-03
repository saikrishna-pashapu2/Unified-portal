"use server";

import { env } from "@/lib/config/env";

function isValidUrl(u?: string | null) {
  if (!u) return false;
  if (u.includes("<") || u.includes(">")) return false; // placeholder guard
  try { new URL(u); return true; } catch { return false; }
}

export async function summarizeText(text: string) {
  const url = env.CUSTOM_AI_URL;
  const key = env.CUSTOM_AI_KEY;

  if (!isValidUrl(url) || !key) {
    return { ok: false, summary: "Summarization service is not configured." };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      return { ok: false, summary: `Service error: ${res.status}` };
    }
    const data = await res.json(); // expect { summary: string }
    return { ok: true, summary: data.summary ?? "" };
  } catch (err: any) {
    return { ok: false, summary: `Summarizer unreachable: ${err?.message || String(err)}` };
  }
}
