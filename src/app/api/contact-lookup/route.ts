import { GoogleGenerativeAI } from "@google/generative-ai";

const MODELS = ["gemini-2.5-flash", "gemma-4-27b-it", "gemini-2.5-flash-lite"];
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

export async function POST(request: Request) {
  try {
    const { url, title, companyInfo } = await request.json();

    if (!url) {
      return Response.json({ error: "URL is required" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Gemini API key is not configured" }, { status: 500 });
    }

    const prompt = `You are a business intelligence assistant. Given the following lead information, research and infer the best contact methods.

LEAD:
Title: ${title || "N/A"}
URL: ${url}
Company: ${companyInfo || "N/A"}

Based on the URL domain and company name, provide your best inference for contact methods. Output ONLY valid JSON with these optional fields:
{
  "email": "most likely contact email (e.g. info@company.com, careers@company.com)",
  "linkedIn": "LinkedIn company or person URL if inferable from the company name",
  "webForm": "contact page URL, typically /contact on the same domain",
  "phone": "phone number if commonly listed",
  "notes": "brief explanation of how you inferred these and any caveats"
}

Only include fields you have reasonable confidence in. For the webForm, construct it from the URL domain (e.g., https://example.com/contact). For LinkedIn, construct a search URL like https://www.linkedin.com/company/COMPANY-NAME if a company name is available.`;

    const text = await generateWithFallback(apiKey, prompt);
    const jsonString = text.replace(/```json|```/g, "").trim();
    const contactMethods = JSON.parse(jsonString);

    return Response.json({ contactMethods });
  } catch (error: any) {
    console.error("Contact lookup error:", error);
    return Response.json(
      { error: error.message || "Failed to look up contacts" },
      { status: 500 }
    );
  }
}
