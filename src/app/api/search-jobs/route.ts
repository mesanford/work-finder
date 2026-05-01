import { GoogleGenerativeAI } from "@google/generative-ai";

const RETRYABLE = (err: any) => {
  const msg = err?.message || "";
  const status = err?.status || err?.response?.status;
  return msg.includes("429") || msg.includes("503") || status === 429 || status === 503;
};
const SKIP_MODEL = (err: any) => {
  const msg = err?.message || "";
  return msg.includes("404") || msg.includes("not found");
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function generateWithBackoff(
  genAI: GoogleGenerativeAI,
  models: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: any[],
  prompt: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generationConfig: any = { thinkingConfig: { thinkingBudget: 0 } },
  maxRetries = 2
) {
  let lastError: any;
  for (const modelName of models) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName, tools, generationConfig });
        return await model.generateContent(prompt);
      } catch (err: any) {
        lastError = err;
        if (SKIP_MODEL(err)) break;
        if (!RETRYABLE(err)) throw err;
        if (attempt < maxRetries - 1) await sleep(Math.pow(2, attempt) * 1000 + Math.random() * 1000);
      }
    }
  }
  throw lastError;
}

function parseJsonArray(text: string): any[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
}

const SEARCH_PAGE_PATTERNS = [
  /[?&](q|query|search|keywords?|k|what|term|jobtitle|l|location)=/i,
  /\/jobs\/search/i,
  /\/job-search/i,
  /\/jobs-search/i,
  /\/search\?(.*)(job|role|position)/i,
  /\/results(\?|\/)/i,
  /\/find(\?|\/jobs)/i,
  /\/vacancies\?/i,
  /\/positions\?/i,
  /\/jobs\?((?!id=|jk=|jobid=).)*$/i,
  /\/career-search/i,
  /\/all-jobs/i,
];

function isSearchResultPage(url: string): boolean {
  if (!url) return false;
  // Deep link common patterns
  if (url.includes("linkedin.com/jobs/view/")) return false;
  if (url.includes("lever.co/") && url.split("/").length > 4) return false;
  if (url.includes("greenhouse.io/") && url.includes("/jobs/")) return false;
  
  return SEARCH_PAGE_PATTERNS.some((p) => p.test(url));
}

function isLinkValid(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("fiverr.com") || parsed.hostname.includes("freelancer.com")) return false;
    if (parsed.pathname === "/" || parsed.pathname === "") return false;
  } catch {
    return false;
  }
  return !isSearchResultPage(url);
}

const SUPPLY_EXCLUSIONS = `-site:fiverr.com -site:upwork.com/freelancers -site:freelancer.com/u -"available for hire" -"I will" -"hire me" -"looking for work"`;

export async function POST(request: Request) {
  try {
    const { keywords, projectTypes, companyTypes, companySizes, maxResults = 25 } = await request.json();

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return Response.json({ error: "At least one keyword is required" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Gemini API key not configured" }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const models = ["gemini-2.5-flash", "gemini-2.0-flash"]; // Added 2.0 as fallback
    const searchTools = [{ googleSearch: {} } as any];
    const noThinkConfig = { thinkingConfig: { thinkingBudget: 0 } };

    // --- STEP 1: QUERY EXPANSION ---
    // Generate multiple specific search strategies to get more diverse results
    const queryModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const expansionPrompt = `Given these keywords: ${keywords.join(", ")}
And these preferences: ${projectTypes?.join(", ") || "None"}
Generate 4 distinct, highly targeted Google Search queries to find DIRECT hiring opportunities.
Mix strategies: 
1. Direct company career sites (site:lever.co, site:greenhouse.io)
2. Professional networks (LinkedIn, Indeed)
3. Niche boards or industry specific sites
4. Direct "hiring for" or "looking for" posts

Output ONLY a JSON array of 4 strings.`;

    const expansionResult = await queryModel.generateContent(expansionPrompt);
    const expandedQueries = parseJsonArray(expansionResult.response.text());
    const searchQueries = expandedQueries.length >= 3 ? expandedQueries : [keywords.join(" ")];

    console.log("Expanding search with queries:", searchQueries);

    // --- STEP 2: PARALLEL SEARCH ---
    const typeFilter = projectTypes?.length ? `Focus on these types: ${projectTypes.join(", ")}.` : "";
    const companyFilter = companyTypes?.length ? `Prefer companies that are: ${companyTypes.join(", ")}.` : "";
    const sizeFilter = companySizes?.length ? `Prefer company sizes: ${companySizes.join(", ")} employees.` : "";

    const searchTasks = searchQueries.map(async (query) => {
      const prompt = `Search for currently open job postings for: ${query}
Original Keywords: ${keywords.join(", ")}
${typeFilter} ${companyFilter} ${sizeFilter}

Find demand-side opportunities (companies HIRING, not service providers).
Exclude: ${SUPPLY_EXCLUSIONS}

CRITICAL: Return ONLY deep links to specific job descriptions. 
REJECT: Search results pages, homepages, or list pages.

For each result, evaluate its "fit" against the keywords "${keywords.join(", ")}" and requirements.
Return a JSON array of objects with:
- title: Job title
- company: Company name
- snippet: 1-2 sentence description
- link: Direct URL
- projectType: Contract, Freelance, Full-Time, etc.
- location: City/Remote
- priority: Integer 1-5 (5 = perfect match for keywords)
- matchReason: Brief sentence explaining why this is a good fit.`;

      try {
        const result = await generateWithBackoff(genAI, models, searchTools, prompt, noThinkConfig, 2);
        return parseJsonArray(result.response.text());
      } catch (err) {
        console.error(`Search failed for query "${query}":`, err);
        return [];
      }
    });

    const resultsArray = await Promise.all(searchTasks);
    const rawItems = resultsArray.flat();

    // --- STEP 3: DEDUPLICATION & VALIDATION ---
    const seenLinks = new Set<string>();
    const jobs = rawItems
      .filter((item: any) => {
        if (!item || !item.link) return false;
        if (seenLinks.has(item.link)) return false;
        if (!isLinkValid(item.link)) return false;
        seenLinks.add(item.link);
        return true;
      })
      .slice(0, maxResults);

    console.log(`Aggregated search: ${jobs.length} unique validated results from ${rawItems.length} raw`);

    return Response.json({ jobs });
  } catch (error: any) {
    console.error("Job search error:", error);
    return Response.json({ error: error.message || "Failed to search for jobs" }, { status: 500 });
  }
}
