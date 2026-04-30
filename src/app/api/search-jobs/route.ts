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
];

function isSearchResultPage(url: string): boolean {
  return SEARCH_PAGE_PATTERNS.some((p) => p.test(url));
}

async function isLinkValid(url: string): Promise<boolean> {
  if (isSearchResultPage(url)) return false;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    const final = new URL(res.url);
    if (isSearchResultPage(final.href)) return false;
    return final.pathname.length > 1;
  } catch {
    return false;
  }
}

const SUPPLY_EXCLUSIONS = `-site:fiverr.com -site:upwork.com/freelancers -site:freelancer.com/u -"available for hire" -"I will"`;

export async function POST(request: Request) {
  try {
    const { keywords, projectTypes, companyTypes, companySizes } = await request.json();

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return Response.json({ error: "At least one keyword is required" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Gemini API key not configured" }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const searchTools = [{ googleSearch: {} } as any];
    const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
    const noThinkConfig = { thinkingConfig: { thinkingBudget: 0 } };

    const typeFilter = projectTypes?.length ? `Focus on these types: ${projectTypes.join(", ")}.` : "";
    const companyFilter = companyTypes?.length ? `Prefer companies that are: ${companyTypes.join(", ")}.` : "";
    const sizeFilter = companySizes?.length ? `Prefer company sizes: ${companySizes.join(", ")} employees.` : "";

    const prompt = `Search for real, currently open job postings and contract opportunities where COMPANIES ARE HIRING for these skills:

Keywords: ${keywords.join(", ")}
${typeFilter}
${companyFilter}
${sizeFilter}

Find 5-8 demand-side opportunities (companies seeking contractors, NOT freelancers offering services).
Exclude supply-side platforms: ${SUPPLY_EXCLUSIONS}

CRITICAL URL RULES — each link MUST:
- Point to a single, specific job listing page (e.g. linkedin.com/jobs/view/1234567890, lever.co/company/role, greenhouse.io/company/job)
- NOT be a search results page (reject any URL with /search, /jobs/search, ?q=, ?query=, ?keywords=, ?search= in it)
- NOT be a homepage, category page, or company careers landing page
If you cannot find a verified deep link to an individual posting, omit that result.

Return ONLY a valid JSON array of objects with these fields:
- title: The job/project title
- company: The company name
- snippet: A 1-2 sentence description of the role/project
- link: The direct, actual URL to the specific posting
- projectType: One of "Contract", "Part-Time", "Freelance", "RFP", "Full-Time Remote", "Consulting"
- location: The location or "Remote"
- source: "job_board"

Output ONLY the JSON array.`;

    const result = await generateWithBackoff(genAI, models, searchTools, prompt, noThinkConfig, 3);
    const rawItems = parseJsonArray(result.response.text());

    // URL validation — drop 404s and root-domain redirects
    const validationResults = await Promise.allSettled(rawItems.map((item: any) => isLinkValid(item.link)));
    const jobs = rawItems.filter((_: any, i: number) => {
      const r = validationResults[i];
      return r.status === "fulfilled" && r.value;
    });

    console.log(`Job search: ${jobs.length} validated of ${rawItems.length} raw`);

    return Response.json({ jobs });
  } catch (error: any) {
    console.error("Job search error:", error);
    return Response.json({ error: error.message || "Failed to search for jobs" }, { status: 500 });
  }
}
