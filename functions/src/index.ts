import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { defineSecret } from "firebase-functions/params"; // v2

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
  generationConfig: any = {},
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

admin.initializeApp();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

export const searchProjects = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 300 }, async (request) => {
  const { query, keywords, projectTypes, companyTypes, userId } = request.data;
  
  // Support both direct query and profile-based search
  const searchQuery = query || (keywords ? keywords.join(" ") : null);
  
  if (!searchQuery) {
    throw new HttpsError("invalid-argument", "Query or keywords are required");
  }

  // Use the user's ID if provided, otherwise the auth context
  const targetUserId = userId || request.auth?.uid;
  if (!targetUserId) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
    const searchTools = [{ googleSearchRetrieval: {} } as any];
    const models = [
      "gemini-3.1-flash-preview",
      "gemini-3-flash-preview", 
      "gemini-2.0-flash",
      "gemini-2.5-flash", 
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b"
    ];
    // Disable thinking so grounding output isn't consumed by reasoning tokens
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noThinkConfig: any = { thinkingConfig: { thinkingBudget: 0 } };

    let items: { title: string; link: string; snippet: string }[] = [];
    let groundedText = "";

    try {
      // Step 1: grounded call with a search-focused prompt to get real URLs from Google Search
      const groundingPrompt = `Search for specific, currently open job postings, contract opportunities, RFPs, and freelance projects matching: "${searchQuery}". 
Focus on finding direct links to individual listings and postings, not general site homepages. 
Return ONLY a valid JSON array of objects with these fields:
- title: The job/project title
- link: The direct URL to the specific posting (deep link)
- snippet: A 1-2 sentence description

Return ONLY the JSON array.`;

      const groundedResult = await generateWithBackoff(
        genAI, models, searchTools, groundingPrompt, noThinkConfig, 3
      );

      groundedText = groundedResult.response.text();
      console.log("Grounded text length:", groundedText.length);

      const start = groundedText.indexOf("[");
      const end = groundedText.lastIndexOf("]");

      if (start !== -1 && end > start) {
        try {
          items = JSON.parse(groundedText.slice(start, end + 1));
        } catch (e) {
          console.error("Failed to parse grounded JSON:", e);
        }
      }
    } catch (searchError) {
      console.error("Grounded search failed entirely after retries:", searchError);
      // Continue to Step 2 fallback
    }

    if (items.length === 0) {
      // Step 2 fallback: no JSON found, parse failed, or Step 1 crashed
      console.log("Falling back to non-tool JSON call from knowledge base");
      const jsonPrompt = `List up to 10 real job postings, contracts, or project platforms relevant to: "${searchQuery}".
Return ONLY a JSON array, each item: { "title": "...", "link": "https://...", "snippet": "..." }`;
      const fallbackResult = await generateWithBackoff(
        genAI, models, [], jsonPrompt, noThinkConfig, 3
      );
      const text = fallbackResult.response.text();
      const fStart = text.indexOf("[");
      const fEnd = text.lastIndexOf("]");
      if (fStart === -1 || fEnd <= fStart) {
        throw new HttpsError("internal", `Search returned no results. Response: ${text.slice(0, 200)}`);
      }
      items = JSON.parse(text.slice(fStart, fEnd + 1));
    }
    const leadsCollection = admin.firestore().collection("leads");

    // Fetch existing links for this user to deduplicate
    const existingLeads = await leadsCollection.where("userId", "==", targetUserId).get();
    const existingLinks = new Set(existingLeads.docs.map(doc => doc.data().link));

    let count = 0;
    let duplicatesSkipped = 0;

    const batch = admin.firestore().batch();
    items.forEach((item) => {
      if (item.link && existingLinks.has(item.link)) {
        duplicatesSkipped++;
        return;
      }

      const docRef = leadsCollection.doc();
      batch.set(docRef, {
        title: item.title || searchQuery,
        link: item.link || "",
        snippet: item.snippet || "",
        source: "google_search",
        status: "new",
        userId: targetUserId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        query: searchQuery,
        // Include profile metadata if available
        projectType: (projectTypes && projectTypes.length > 0) ? projectTypes[0] : null,
        companyInfo: (companyTypes && companyTypes.length > 0) ? companyTypes[0] : null,
      });
      count++;
    });

    if (count > 0) {
      await batch.commit();
    }

    return { success: true, count, duplicatesSkipped };
  } catch (error: any) {
    console.error("Search error:", error);
    throw new HttpsError("internal", error.message);
  }
});

export const processLeadOnCreate = onDocumentCreated({ document: "leads/{leadId}", secrets: [GEMINI_API_KEY] }, async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const data = snapshot.data();
  // Only process new leads that haven't been processed yet
  if (data.status !== "new") return;

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

  const prompt = `
    Analyze the following lead information extracted from a search result:
    Title: ${data.title}
    Snippet: ${data.snippet}
    Link: ${data.link}

    Extract and summarize the following in JSON format:
    - description: A concise summary of the project or job opening.
    - projectType: Is it a project bid, contract role, or part-time job?
    - keySkills: A list of required skills or keywords as an array of strings.
    - companyInfo: Name of the company and any size/type info if available.
    - contactMethods: Suggested ways to reach out (email, form, social profile).
    - priority: A number from 1-5 based on how well it fits a software engineering company profile.

    Output ONLY valid JSON.
  `;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    // Clean up potential markdown formatting in response
    const jsonString = responseText.replace(/```json|```/g, "").trim();
    const processedInfo = JSON.parse(jsonString);

    await snapshot.ref.update({
      ...processedInfo,
      status: "processed",
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("Gemini processing error:", error);
    // Don't mark as error if it's just a parse failure, maybe it's not a valid lead
    // But update status so we don't keep trying
    await snapshot.ref.update({
      status: "processed", // Move past 'new' even if AI fails
      aiError: (error as Error).message,
    });
  }
});
