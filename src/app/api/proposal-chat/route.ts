import { GoogleGenerativeAI, Content } from "@google/generative-ai";

export async function POST(request: Request) {
  try {
    const { lead, companyProfile, history, userMessage, knowledgeContext } = await request.json();

    if (!lead) {
      return Response.json(
        { error: "Lead data is required" },
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

    // Build Knowledge Base context section from selected entries
    let knowledgeSection = "";
    if (Array.isArray(knowledgeContext) && knowledgeContext.length > 0) {
      const entries = knowledgeContext
        .map((e: { title: string; content: string; type?: string }) =>
          `### ${e.title}${e.type ? ` (${e.type})` : ""}\n${e.content}`
        )
        .join("\n\n");
      knowledgeSection = `\nKNOWLEDGE BASE CONTEXT — Use the following reference materials when crafting your responses. These are provided by the user and should be treated as authoritative:\n\n${entries}\n`;
    }

    const systemInstruction = `You are a professional business development assistant working within a proposal builder tool.

CONTEXT — Lead Information:
Title: ${lead.title}
Description: ${lead.description || "N/A"}
Company: ${lead.companyInfo || "Unknown"}
Required Skills: ${Array.isArray(lead.keySkills) ? lead.keySkills.join(", ") : lead.keySkills || "N/A"}
Contact Methods: ${typeof lead.contactMethods === "object" ? JSON.stringify(lead.contactMethods) : lead.contactMethods || "N/A"}
Project Type: ${lead.projectType || "N/A"}

${companyProfile ? `OUR COMPANY PROFILE:\n${companyProfile}` : ""}
${knowledgeSection}
${lead.notes ? `USER NOTES ON THIS LEAD:\n${lead.notes}` : ""}

INSTRUCTIONS:
- You help the user craft, iterate, and refine proposals, cover letters, emails, and outreach messages for the lead above.
- When first asked to draft a proposal, produce a highly targeted, professional, and compelling outreach message.
- When the user asks for changes (shorter, more formal, emphasize a skill, add pricing, etc.), revise accordingly.
- Always suggest the best outreach method (LinkedIn DM, email, web form, etc.) when appropriate.
- Keep responses focused and professional. Use markdown formatting for readability.
- If the user asks a question about the lead or strategy, answer helpfully using the context above.
- When knowledge base entries are available, actively reference and incorporate the relevant information (company capabilities, past projects, team expertise, pricing guidelines, etc.) to make proposals more specific and credible.`;

    // Build Gemini-compatible chat history
    const chatHistory: Content[] = (history || []).map(
      (msg: { role: string; content: string }) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      })
    );

    const chat = model.startChat({
      history: chatHistory,
      systemInstruction,
    });

    const result = await chat.sendMessage(userMessage || "Draft a proposal for this lead.");
    const text = result.response.text();

    return Response.json({ message: text });
  } catch (error: any) {
    console.error("Proposal chat error:", error);
    return Response.json(
      { error: error.message || "Failed to generate response" },
      { status: 500 }
    );
  }
}
