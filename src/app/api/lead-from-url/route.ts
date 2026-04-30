import { GoogleGenerativeAI } from "@google/generative-ai";

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

    // Fetch the page server-side
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

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are extracting a job or contract opportunity from a web page for a freelance contractor's lead tracking tool.

URL: ${url}
Page content (truncated):
${rawText}

Extract the opportunity details and return a JSON object with:
- title: The job or project title (max 100 chars)
- company: The hiring company or organisation name
- snippet: A 2-3 sentence summary of the opportunity — what they need and what the role involves
- projectType: One of "Contract", "Part-Time", "Freelance", "RFP", "Full-Time Remote", "Consulting"
- location: Location string, or "Remote" if remote
- keySkills: Array of 3-8 required skills or technologies mentioned
- priority: Integer 1-5 estimating how interesting this opportunity is for a senior software/technology contractor (5 = excellent)

Return ONLY valid JSON.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().replace(/```json|```/g, "").trim();

    let lead: {
      title: string;
      company: string;
      snippet: string;
      projectType: string;
      location: string;
      keySkills: string[];
      priority: number;
    };

    try {
      lead = JSON.parse(responseText);
    } catch {
      return Response.json({ error: "Failed to parse extracted lead data" }, { status: 500 });
    }

    return Response.json({ lead });
  } catch (error: any) {
    console.error("Lead from URL error:", error);
    return Response.json({ error: error.message || "Failed to import lead from URL" }, { status: 500 });
  }
}
