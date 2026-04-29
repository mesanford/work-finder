import { GoogleGenerativeAI } from "@google/generative-ai";

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

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    return Response.json({ proposal: text });
  } catch (error: any) {
    console.error("Proposal generation error:", error);
    return Response.json(
      { error: error.message || "Failed to generate proposal" },
      { status: 500 }
    );
  }
}
