import { GoogleGenerativeAI } from "@google/generative-ai";

const RETRYABLE = (err: any) => {
  const msg = err?.message || "";
  const status = err?.status || err?.response?.status;
  return msg.includes("429") || msg.includes("503") || status === 429 || status === 503;
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
        if (!RETRYABLE(err)) throw err;
        if (attempt < maxRetries - 1) await sleep(Math.pow(2, attempt) * 1000 + Math.random() * 1000);
      }
    }
  }
  throw lastError;
}

export async function POST(request: Request) {
  try {
    const { keywords, projectTypes, companyTypes, companySizes } = await request.json();

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return Response.json(
        { error: "At least one keyword is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Gemini API key not configured" },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    // Use the most current tool name for Google Search grounding
    const searchTools = [{ googleSearchRetrieval: {} } as any];
    const models = [
      "gemini-3.1-flash-preview",
      "gemini-3-flash-preview", 
      "gemini-2.0-flash",
      "gemini-2.5-flash", 
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b"
    ];

    const typeFilter = projectTypes?.length
      ? `Focus on these types: ${projectTypes.join(", ")}.`
      : "";
    const companyFilter = companyTypes?.length
      ? `Prefer companies that are: ${companyTypes.join(", ")}.`
      : "";
    const sizeFilter = companySizes?.length
      ? `Prefer company sizes: ${companySizes.join(", ")} employees.`
      : "";

    const prompt = `Search for real, currently open job postings and contract opportunities matching these criteria:

Keywords: ${keywords.join(", ")}
${typeFilter}
${companyFilter}
${sizeFilter}

Find 5-8 real job postings or project opportunities. 
CRITICAL: Focus on direct links to individual job descriptions or project listing pages (deep links). Avoid providing the general homepage of job boards or companies (e.g., provide the link to a specific role on LinkedIn/Indeed, not just LinkedIn.com).

Return ONLY a valid JSON array of objects with these fields:
- title: The job/project title
- company: The company name
- snippet: A 1-2 sentence description of the role/project
- link: The direct, actual URL to the specific posting
- projectType: One of "Contract", "Part-Time", "Freelance", "RFP", "Full-Time Remote", "Consulting"
- location: The location or "Remote"
- source: "job_board"

Output ONLY the JSON array.`;

    let responseText = "";
    try {
      const result = await generateWithBackoff(
        genAI,
        models,
        searchTools,
        prompt,
        { thinkingConfig: { thinkingBudget: 0 } },
        3
      );
      responseText = result.response.text();
    } catch (searchError) {
      console.error("Grounded job search failed entirely, trying fallback:", searchError);
      // Final attempt: knowledge-based search without tools
      const fallbackResult = await generateWithBackoff(
        genAI,
        models,
        [],
        prompt,
        { thinkingConfig: { thinkingBudget: 0 } },
        2
      );
      responseText = fallbackResult.response.text();
    }

    console.log("Job search AI response:", responseText);
    const jsonString = responseText.replace(/```json|```/g, "").trim();

    let jobs;
    try {
      jobs = JSON.parse(jsonString);
    } catch (err) {
      console.error("Failed to parse jobs JSON:", err, "Raw text:", responseText);
      return Response.json(
        { error: "Failed to parse job results from AI" },
        { status: 500 }
      );
    }

    if (!Array.isArray(jobs)) {
      return Response.json(
        { error: "Invalid job results format" },
        { status: 500 }
      );
    }

    return Response.json({ jobs });
  } catch (error: any) {
    console.error("Job search error:", error);
    return Response.json(
      { error: error.message || "Failed to search for jobs" },
      { status: 500 }
    );
  }
}
