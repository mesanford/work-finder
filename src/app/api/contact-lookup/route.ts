import { GoogleGenerativeAI } from "@google/generative-ai";

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

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

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

    const result = await model.generateContent(prompt);
    const text = result.response.text();
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
