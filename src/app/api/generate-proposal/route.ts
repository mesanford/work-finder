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
    const { lead, companyProfile } = await request.json();

    if (!lead || !companyProfile) {
      return Response.json(
        { error: "Lead data and company profile are required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Gemini API key is not configured" },
        { status: 500 }
      );
    }

    const prompt = `
      You are a professional business development assistant.
      Based on the following lead information and our company profile, draft a highly targeted and compelling proposal or outreach message.

      COMPANY PROFILE:
      ${companyProfile}

      LEAD INFORMATION:
      Title: ${lead.title}
      Description: ${lead.description}
      Company: ${lead.companyInfo}
      Required Skills: ${Array.isArray(lead.keySkills) ? lead.keySkills.join(", ") : lead.keySkills || "N/A"}
      Contact Methods: ${typeof lead.contactMethods === "object" ? JSON.stringify(lead.contactMethods) : lead.contactMethods || "N/A"}

      The message should be professional, concise, and highlight why we are the perfect fit.
      Suggest the best method to send this (e.g., LinkedIn DM, Email, Form).
    `;

    const text = await generateWithFallback(apiKey, prompt);

    return Response.json({ proposal: text });
  } catch (error: any) {
    console.error("Proposal generation error:", error);
    return Response.json(
      { error: error.message || "Failed to generate proposal" },
      { status: 500 }
    );
  }
}
