import { GoogleGenerativeAI } from "@google/generative-ai";

const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRetryable = (err: any) => {
  const msg = err?.message || "";
  const status = err?.status || err?.response?.status;
  return msg.includes("429") || msg.includes("503") || status === 429 || status === 503;
};
const skipModel = (err: any) => {
  const msg = err?.message || "";
  return msg.includes("404") || msg.includes("not found");
};

async function generateWithFallback(apiKey: string, prompt: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: any;
  for (const modelName of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        return result.response.text();
      } catch (err: any) {
        lastError = err;
        if (skipModel(err)) break;
        if (!isRetryable(err)) throw err;
        if (attempt === 0) await sleep(2000 + Math.random() * 1000);
      }
    }
  }
  throw lastError;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== "string") {
      return Response.json({ error: "URL is required" }, { status: 400 });
    }

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return Response.json({ error: "Invalid URL" }, { status: 400 });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return Response.json({ error: "Only http and https URLs are supported" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Gemini API key not configured" }, { status: 500 });
    }

    // Fetch the page server-side (bypasses browser CORS)
    let rawText = "";
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; WorkFinder/1.0; +https://work-finder.app)",
          "Accept": "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return Response.json({ error: `Could not fetch URL (${res.status})` }, { status: 400 });
      }
      const html = await res.text();
      rawText = stripHtml(html).slice(0, 10000);
    } catch (err: any) {
      return Response.json({ error: `Failed to fetch URL: ${err.message}` }, { status: 400 });
    }

    if (!rawText.trim()) {
      return Response.json({ error: "No readable content found at this URL" }, { status: 400 });
    }

    const prompt = `You are extracting knowledge base content from a web page for a freelance contractor's proposal tool.

URL: ${url}
Page content (truncated):
${rawText}

Extract the most useful information from this page and return a JSON object with:
- title: A concise, descriptive title for this KB entry (max 60 chars)
- type: One of "company_info", "proposal_template", "resume", "portfolio", "boilerplate", "reference"
  - company_info: information about a company (client, partner, prospect)
  - proposal_template: a template or example for proposals/outreach
  - resume: a CV, bio, or professional profile
  - portfolio: a case study, project showcase, or work sample
  - boilerplate: legal text, terms, standard clauses, rate cards
  - reference: any other useful reference material (articles, specs, RFPs, etc.)
- content: The most relevant extracted text, cleaned up and formatted for use as AI context (max 2000 chars). Focus on facts, not navigation text or boilerplate website copy.
- tags: An array of 3-6 relevant lowercase keyword tags

Return ONLY valid JSON.`;

    const responseText = (await generateWithFallback(apiKey, prompt)).replace(/```json|```/g, "").trim();

    let extracted: { title: string; type: string; content: string; tags: string[] };
    try {
      extracted = JSON.parse(responseText);
    } catch {
      return Response.json({ error: "Failed to parse extracted content" }, { status: 500 });
    }

    return Response.json({ entry: extracted });
  } catch (error: any) {
    console.error("KB from URL error:", error);
    return Response.json({ error: error.message || "Failed to import from URL" }, { status: 500 });
  }
}
