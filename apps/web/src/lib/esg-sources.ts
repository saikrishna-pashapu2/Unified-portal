import "server-only";

const S_AND_P_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const ISS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const LSEG_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function withTimeout<T>(promise: Promise<T>, ms = 30000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return promise.finally(() => clearTimeout(timeout));
}

async function fetchJSON(url: string, init?: RequestInit) {
  const response = await withTimeout(fetch(url, init), 30000);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function fetchText(url: string, init?: RequestInit) {
  const response = await withTimeout(fetch(url, init), 30000);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function postJSON(url: string, body: unknown, headers: Record<string, string>) {
  return fetchJSON(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function normalizeHtmlText(text: string) {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function fetchSnpEsgSource(name: string) {
  try {
    const searchUrl = `https://www.spglobal.com/api/apps/s1/query/s1-scores?q=${encodeURIComponent(
      name,
    )}&auto=true`;

    const searchHeaders: Record<string, string> = {
      "user-agent": S_AND_P_UA,
      accept: "application/json, text/plain, */*",
      referer: "https://www.spglobal.com/sustainable1/en/scores/results",
    };

    const searchToken = process.env.SPGLOBAL_SEARCH_TOKEN?.trim();
    if (searchToken) {
      searchHeaders.authorization = `Bearer ${searchToken}`;
    }

    const search = await fetchJSON(searchUrl, { headers: searchHeaders });
    const docs: any[] = search?.response?.docs ?? [];
    if (!docs.length) {
      return { source: "S&P", esg_score: "-" };
    }

    const targetDoc =
      docs.find(
        (doc) =>
          (doc?.es_long_name_s || "").toLowerCase().trim() ===
          name.toLowerCase().trim(),
      ) ??
      docs.find((doc) => {
        const longName = (doc?.es_long_name_s || "").toLowerCase();
        return name
          .toLowerCase()
          .split(/\s+/)
          .every((word) => longName.includes(word));
      }) ??
      docs[0];

    const companyId = targetDoc?.es_company_id_i;
    if (!companyId) {
      return { source: "S&P", esg_score: "-" };
    }

    const pageUrl = `https://www.spglobal.com/content/spglobal/sustainable1/us/en/scores/results.html?cid=${companyId}`;
    const html = await fetchText(pageUrl, {
      headers: {
        "user-agent": S_AND_P_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: `https://www.spglobal.com/sustainable1/en/scores/results?cid=${companyId}`,
      },
    });

    const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    const companyName = h1Match
      ? normalizeHtmlText(h1Match[1]).replace(/ ESG Score$/i, "")
      : undefined;

    const rowsRaw: string[] = [];
    const rowRegex = /<div[^>]+role=["']row["'][^>]*>([\s\S]*?)<\/div>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      rowsRaw.push(rowMatch[1]);
    }

    let rowData: string[] | null = null;
    for (const row of rowsRaw) {
      const cellRegex =
        /<div[^>]+role=["'](?:cell|columnheader)["'][^>]*>([\s\S]*?)<\/div>/gi;
      const cells: string[] = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(row)) !== null) {
        cells.push(normalizeHtmlText(cellMatch[1]));
      }
      if (cells.length >= 6 && cells[0]?.toLowerCase() !== "company") {
        rowData = cells.slice(0, 6);
        break;
      }
    }

    return {
      source: "S&P",
      company_id: companyId,
      company_name: companyName || targetDoc?.es_long_name_s || name,
      long_name: rowData?.[0] ?? companyName ?? name,
      industry: rowData?.[1] ?? "-",
      csa_score: rowData?.[2] ?? "-",
      esg_score: rowData?.[3] ?? "-",
      score_under_review: rowData?.[4] ?? "-",
      last_updated: rowData?.[5] ?? "-",
      url: pageUrl,
    };
  } catch {
    return { source: "S&P", esg_score: "-" };
  }
}
export async function fetchIssEsgSource(name: string) {
  try {
    const searchUrl = "https://marketingwidget.iss-corporate.com/api/searchCompany";
    const searchHeaders = {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      "user-agent": ISS_UA,
      origin: "https://marketingwidget.iss-corporate.com",
      referer: "https://marketingwidget.iss-corporate.com/home",
    };

    const searchData = await postJSON(searchUrl, { searchTerm: name }, searchHeaders);
    if (!Array.isArray(searchData) || searchData.length === 0) {
      return { source: "ISS", oekomRating: "-" };
    }

    const picked = searchData[0];
    const entityId = picked?.entityId || picked?.entityID || picked?.EntityId;
    if (!entityId) {
      return { source: "ISS", oekomRating: "-" };
    }

    const detailUrl = `https://marketingwidget.iss-corporate.com/api/getCompanyDetails/${encodeURIComponent(entityId)}`;
    const details = await postJSON(
      detailUrl,
      {},
      {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        "user-agent": ISS_UA,
      },
    );

    const list = details?.companyData ?? [];
    if (!Array.isArray(list) || list.length === 0) {
      return { source: "ISS", oekomRating: "-" };
    }

    const first = { ...list[0], source: "ISS" };
    if (first.oekomRating == null) first.oekomRating = "-";
    return first;
  } catch {
    return { source: "ISS", oekomRating: "-" };
  }
}

function cleanTokens(name: string) {
  const tokens = name.toLowerCase().split(/\s+/);
  const stop = new Set([
    "s.a.",
    "ltd",
    "inc",
    "co",
    "company",
    "corporation",
    "limited",
    "plc",
    "corp",
  ]);
  return tokens.filter((token) => !stop.has(token));
}

function bestLsegMatch(user: string, companies: any[]): { name: string; ric: string } | null {
  const userLower = user.toLowerCase();
  const userTokens = cleanTokens(userLower);
  let best: { name: string; ric: string } | null = null;
  let bestScore = 0;

  for (const company of companies) {
    const companyName: string = company.companyName || "";
    const ric = company.ricCode || "";
    const companyLower = companyName.toLowerCase();
    const companyTokens = cleanTokens(companyLower);

    if (companyLower === userLower) return { name: companyName, ric };

    const common = userTokens.filter((token) => companyTokens.includes(token));
    const tokenScore = userTokens.length ? common.length / userTokens.length : 0;
    if (tokenScore >= 0.8) {
      const lenSim =
        1 -
        Math.abs(userLower.length - companyLower.length) /
          Math.max(userLower.length, companyLower.length);
      const score = tokenScore * 0.7 + lenSim * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = { name: companyName, ric };
      }
    }
  }

  return bestScore >= 0.6 ? best : null;
}

export async function fetchLsegEsgSource(name: string) {
  try {
    const suggestUrl = "https://www.lseg.com/bin/esg/esgsearchsuggestions";
    const suggestions = await fetchJSON(suggestUrl, {
      headers: {
        "user-agent": LSEG_UA,
        accept: "*/*",
        referer: "https://www.lseg.com/en/data-analytics/sustainable-finance/esg-scores",
      },
    });

    const match = bestLsegMatch(name, Array.isArray(suggestions) ? suggestions : []);
    if (!match) {
      return { source: "LSEG", "TR.TRESG": "-" };
    }

    const resultUrl = `https://www.lseg.com/bin/esg/esgsearchresult?ricCode=${encodeURIComponent(match.ric)}`;
    const data = await fetchJSON(resultUrl, {
      headers: {
        "user-agent": LSEG_UA,
        accept: "*/*",
        referer: `https://www.lseg.com/en/data-analytics/sustainable-finance/esg-scores?esg=${encodeURIComponent(match.name)}`,
      },
    });

    const out: Record<string, any> = {
      source: "LSEG",
      "Company Name": match.name,
      "Ric Code": match.ric,
    };

    const industryComparison = data?.industryComparison ?? {};
    out["Industry Type"] = industryComparison.industryType ?? "N/A";
    out["Score Year"] = industryComparison.scoreYear ?? "N/A";
    if (industryComparison.rank != null && industryComparison.totalIndustries != null) {
      out["Rank"] = `${industryComparison.rank} out of ${industryComparison.totalIndustries}`;
    }

    const esg = data?.esgScore ?? {};
    out["TR.TRESG"] = esg?.["TR.TRESG"]?.score ?? esg?.["TR.TRESG.Score"] ?? "-";
    out["TR.GovernancePillar"] = esg?.["TR.GovernancePillar"]?.score ?? "N/A";
    out["TR.EnvironmentPillar"] = esg?.["TR.EnvironmentPillar"]?.score ?? "N/A";
    out["TR.SocialPillar"] = esg?.["TR.SocialPillar"]?.score ?? "N/A";

    return out;
  } catch {
    return { source: "LSEG", "TR.TRESG": "-" };
  }
}
