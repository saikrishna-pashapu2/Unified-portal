/* Fitch GraphQL helpers + DB cache (Credit DB) */

import { getPrisma } from "@/lib/db";

const FITCH_ENDPOINT = "https://api.fitchratings.com/";

function norm(s: string) {
  return s.trim().toLowerCase();
}

async function postGQL(query: string, variables: any, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(FITCH_ENDPOINT, {
        method: "POST",
        headers: {
          "accept": "*/*",
          "accept-language": "en-US,en;q=0.9",
          "content-type": "application/json",
          "origin": "https://www.fitchratings.com",
          "priority": "u=1, i",
          "referer": "https://www.fitchratings.com/",
          "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-site",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Cookie": "SSID_P=CQD5_B1GAAQAAACgzzlm4GeAA6DPOWYXAAAAAAAAAAAA57BFZwC3344AAAF1FAAA57BFZwEAkgAAA0UVAABxFSNnAgCLAAAByhMAAOewRWcBACoAAAELBQAA57BFZwEAeAAAAR0RAADnsEVnAQB0AAAA; SSOD_P=ABG_AAAAEgC6AAAAEQAAAKDPOWYRJVhmAAAAAA; SSRT_P=cLlFZwADAA; SSSC_P=1.G7366146951701620704.23|42.1291:120.4381:139.5066:142.5237:146.5445"
        },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
      });
      
      if (res.ok) return res.json();
      
      // If it's a 5xx error and we have retries left, try again
      if (res.status >= 500 && attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
        console.log(`Fitch API error ${res.status}, retrying in ${delay}ms... (attempt ${attempt + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw new Error(`Fitch API error ${res.status}`);
    } catch (err: any) {
      // If it's a network error and we have retries left, try again
      if (attempt < retries - 1 && err.message.includes("fetch")) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Network error, retrying in ${delay}ms... (attempt ${attempt + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

export async function getSlug(companyName: string) {
  const q = `
    query Suggest($item: SearchItem, $term: String!) {
      suggest(item: $item, term: $term) {
        entity {
          name
          permalink
        }
      }
    }`;
  const data = await postGQL(q, { item: "ENTITY", term: companyName });
  const items: Array<{name: string; permalink: string}> =
    data?.data?.suggest?.entity ?? [];
  const lc = companyName.toLowerCase();
  const hit = items.find((e) => e.name?.toLowerCase()?.includes(lc));
  return hit ? { name: hit.name, slug: hit.permalink } : null;
}

export async function getCompany(slug: string) {
  const q = `
    query Entity($slug: String!) {
      getEntity(slug: $slug) {
        name
        ratings {
          ratingCode
          ratingActionDescription
          ratingChangeDate
          ratingTypeDescription
          ratingAlertCode
        }
        ratingHistory {
          ratingCode
          ratingActionDescription
          ratingChangeDate
          ratingTypeDescription
        }
        latestRAC {
          rows {
            title
            slug
          }
        }
      }
    }`;
  const data = await postGQL(q, { slug });
  return data?.data?.getEntity ?? null;
}

export async function searchCompanyCached(userInput: string) {
  const prisma = getPrisma("credit");
  const n = norm(userInput);

  // 1) check cache
  const cached = await prisma.$queryRaw<
    { details: any; name: string }[]
  >`
    SELECT details, name FROM company_details
    WHERE normalized_name = ${n}
    LIMIT 1
  `;
  if (cached.length) {
    return { fromCache: true, company: cached[0].details };
  }

  // 2) resolve slug then fetch details
  const slugInfo = await getSlug(userInput);
  if (!slugInfo) return { fromCache: false, company: null };

  const company = await getCompany(slugInfo.slug);
  if (!company) return { fromCache: false, company: null };

  // 3) store in cache
  await prisma.$queryRawUnsafe(
    `INSERT INTO company_details (name, slug, details, normalized_name, user_entered_name)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (normalized_name) DO UPDATE SET
       details = EXCLUDED.details,
       name = EXCLUDED.name,
       slug = EXCLUDED.slug`,
    slugInfo.name,
    slugInfo.slug,
    company,
    n,
    userInput
  );

  return { fromCache: false, company };
}