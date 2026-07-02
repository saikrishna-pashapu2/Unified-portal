function uniqueKeywords(values: string[]): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const value of values) {
    const keyword = value.trim();
    if (!keyword) continue;

    const key = keyword.toLocaleLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    keywords.push(keyword);
  }

  return keywords;
}

export function parseKeywords(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return uniqueKeywords(raw.map(String));
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) return uniqueKeywords(j.map(String));
    } catch {}
    return uniqueKeywords(raw
      .replace(/^\{|\}$/g, "")
      .split(/[;,]/g)
      .map((s) => s.trim().replace(/^"|"$/g, "").trim()));
  }
  if (typeof raw === "object") {
    const vals: string[] = [];
    for (const v of Object.values(raw)) {
      if (Array.isArray(v)) vals.push(...(v as any[]).map(String));
      else if (typeof v === "string") vals.push(v);
    }
    return uniqueKeywords(vals);
  }
  return [];
}
