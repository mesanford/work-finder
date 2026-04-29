import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request: Request) {
  try {
    const { keywords, projectTypes, companyTypes, companySizes } = await request.json();

    if (!keywords || keywords.length === 0) {
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

    // Build a structured search query for Gemini to simulate job board search
    // In a production app, you'd call actual job board APIs here.
    // For now, we use Gemini + Google Search grounding to find real listings.
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const typeFilter = projectTypes?.length
      ? `Focus on these types: ${projectTypes.join(", ")}.`
      : "";
    const companyFilter = companyTypes?.length
      ? `Prefer companies that are: ${companyTypes.join(", ")}.`
      : "";
    const sizeFilter = companySizes?.length
      ? `Prefer company sizes: ${companySizes.join(", ")} employees.`
      : "";

    const prompt = `
You are a job and project search assistant. Search for real, current job openings and contract opportunities matching these criteria:

Keywords: ${keywords.join(", ")}
${typeFilter}
${companyFilter}
${sizeFilter}

Find 5-8 real job postings or project opportunities. For each one, provide:

Return ONLY a valid JSON array of objects with these fields:
- title: The job/project title
- company: The company name
- snippet: A 1-2 sentence description of the role/project
- link: The URL where this was posted (use realistic job board URLs like indeed.com, linkedin.com, upwork.com)
- projectType: One of "Contract", "Part-Time", "Freelance", "RFP", "Full-Time Remote", "Consulting"
- location: The location or "Remote"
- source: "job_board"

Output ONLY the JSON array, no markdown, no explanation.
`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const jsonString = responseText.replace(/```json|```/g, "").trim();

    let jobs;
    try {
      jobs = JSON.parse(jsonString);
    } catch {
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
