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
const SKIP_MODEL = (err: any) => {
  const msg = err?.message || "";
  return msg.includes("404") || msg.includes("not found");
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
        if (SKIP_MODEL(err)) break;
        if (!RETRYABLE(err)) throw err;
        if (attempt < maxRetries - 1) await sleep(Math.pow(2, attempt) * 1000 + Math.random() * 1000);
      }
    }
  }
  throw lastError;
}

function parseJsonArray(text: string): any[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
}

async function isLinkValid(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    const final = new URL(res.url);
    return final.pathname.length > 1;
  } catch {
    return false;
  }
}

admin.initializeApp();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const SUPPLY_EXCLUSIONS = `-site:fiverr.com -site:upwork.com/freelancers -site:freelancer.com/u -"available for hire" -"I will"`;

export const searchProjects = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 300 }, async (request) => {
  const { query, keywords, projectTypes, companyTypes, userId } = request.data;

  const searchKeywords: string[] = keywords || (query ? [query] : []);
  if (searchKeywords.length === 0) {
    throw new HttpsError("invalid-argument", "Query or keywords are required");
  }

  const targetUserId = userId || request.auth?.uid;
  if (!targetUserId) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
  const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
  const noThinkConfig: any = { thinkingConfig: { thinkingBudget: 0 } };
  const searchTools = [{ googleSearch: {} } as any];

  // Stage 1: KB Profile Build
  let profileText = "";
  try {
    const kbSnap = await admin.firestore()
      .collection("knowledgeBase")
      .where("userId", "==", targetUserId)
      .where("type", "in", ["resume", "portfolio", "boilerplate"])
      .get();

    profileText = kbSnap.docs
      .map((d) => `[${d.data().type}] ${d.data().title}:\n${d.data().content}`)
      .join("\n\n")
      .slice(0, 3000);
  } catch (err) {
    console.error("KB read failed, proceeding without profile:", err);
  }

  // Stage 2: Query Generation
  let queries: string[] = [];

  if (profileText) {
    const typeFilter = projectTypes?.length ? `Project types: ${projectTypes.join(", ")}` : "";
    const companyFilter = companyTypes?.length ? `Company types: ${companyTypes.join(", ")}` : "";

    const queryGenPrompt = `You are helping a senior technology contractor find paid work opportunities.

Contractor profile:
${profileText}

Search criteria:
- Keywords: ${searchKeywords.join(", ")}
${typeFilter}
${companyFilter}

Generate 4-6 Google search queries that will find DEMAND-SIDE opportunities only — companies, agencies, or governments seeking to hire or contract this person's services.

Rules:
- Every query must be from the buyer's perspective ("hiring", "seeking", "RFP", "contract opportunity", "statement of work")
- Append these exclusions to every query: ${SUPPLY_EXCLUSIONS}
- Vary query structure: mix job boards (site:linkedin.com/jobs), government sources (site:sam.gov), and open web
- Tailor queries to the contractor's specific stack and seniority from the profile above

Return ONLY a JSON array of strings.`;

    try {
      const queryGenResult = await generateWithBackoff(genAI, models, [], queryGenPrompt, noThinkConfig, 2);
      queries = parseJsonArray(queryGenResult.response.text()).filter((q) => typeof q === "string");
    } catch (err) {
      console.error("Query generation failed:", err);
    }
  }

  // Fallback: single keyword query with exclusions
  if (queries.length === 0) {
    queries = [`${searchKeywords.join(" ")} contract opportunity hiring ${SUPPLY_EXCLUSIONS}`];
  }

  // Stage 3: Parallel Grounded Search
  const searchResults = await Promise.allSettled(
    queries.map((q) =>
      generateWithBackoff(
        genAI,
        models,
        searchTools,
        `Search for currently open job postings and contract opportunities matching: "${q}"

Return ONLY a valid JSON array of objects with:
- title: The job/project title
- link: The direct URL to the specific posting (deep link, not a homepage)
- snippet: A 1-2 sentence description

Return ONLY the JSON array.`,
        noThinkConfig,
        2
      )
    )
  );

  const seen = new Set<string>();
  const allItems: { title: string; link: string; snippet: string }[] = [];

  for (const result of searchResults) {
    if (result.status === "rejected") continue;
    const items = parseJsonArray(result.value.response.text());
    for (const item of items) {
      if (item.link && !seen.has(item.link)) {
        seen.add(item.link);
        allItems.push(item);
      }
    }
  }

  console.log(`Raw items before validation: ${allItems.length}`);

  // URL Validation — parallel HEAD checks
  const validationResults = await Promise.allSettled(allItems.map((item) => isLinkValid(item.link)));
  const validated = allItems.filter((_, i) => {
    const r = validationResults[i];
    return r.status === "fulfilled" && r.value;
  });

  console.log(`Validated items: ${validated.length} of ${allItems.length}`);

  if (validated.length === 0) {
    return { success: true, count: 0, duplicatesSkipped: 0, message: "No verified links found" };
  }

  // Stage 4: Reranking
  let rankedItems: any[] = validated;

  if (profileText) {
    const rerankPrompt = `You are evaluating contract opportunities for a senior technology contractor.

Contractor profile:
${profileText}

Evaluate each opportunity and return a JSON array with these fields:
- title, link, snippet (unchanged from input)
- priority: integer 1-5 (5 = excellent fit for this contractor's profile)
- matchReason: one sentence explaining why this is or isn't a strong fit
- projectType: one of "Contract", "Part-Time", "Freelance", "RFP", "Full-Time Remote", "Consulting"
- companyInfo: company name and any size/type info visible from the snippet

Opportunities:
${JSON.stringify(validated)}

Rules:
- Score 1-2 only if clearly misaligned with the contractor's stack or seniority
- Score 4-5 only if there is explicit skill overlap AND contract type matches their preferences
- Return ONLY the JSON array, preserving all input items`;

    try {
      const rerankResult = await generateWithBackoff(genAI, models, [], rerankPrompt, noThinkConfig, 2);
      const reranked = parseJsonArray(rerankResult.response.text());
      if (reranked.length > 0) rankedItems = reranked;
    } catch (err) {
      console.error("Reranking failed, using unranked validated results:", err);
    }
  }

  // Deduplicate against existing leads
  const leadsCollection = admin.firestore().collection("leads");
  const existingLeads = await leadsCollection.where("userId", "==", targetUserId).get();
  const existingLinks = new Set(existingLeads.docs.map((doc) => doc.data().link));

  let count = 0;
  let duplicatesSkipped = 0;

  const batch = admin.firestore().batch();
  for (const item of rankedItems) {
    if (!item.link || existingLinks.has(item.link)) {
      duplicatesSkipped++;
      continue;
    }
    const docRef = leadsCollection.doc();
    batch.set(docRef, {
      title: item.title || searchKeywords.join(", "),
      link: item.link,
      snippet: item.snippet || "",
      source: "google_search",
      status: "new",
      userId: targetUserId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      query: searchKeywords.join(", "),
      priority: item.priority ?? null,
      matchReason: item.matchReason ?? null,
      projectType: item.projectType ?? (projectTypes?.length ? projectTypes[0] : null),
      companyInfo: item.companyInfo ?? (companyTypes?.length ? companyTypes[0] : null),
    });
    count++;
  }

  if (count > 0) {
    await batch.commit();
  }

  return { success: true, count, duplicatesSkipped };
});

export const processLeadOnCreate = onDocumentCreated({ document: "leads/{leadId}", secrets: [GEMINI_API_KEY] }, async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const data = snapshot.data();
  if (data.status !== "new") return;

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  // If reranking already set priority and projectType, only extract skills and contact methods
  const alreadyScored = data.priority != null && data.projectType != null;

  const prompt = alreadyScored
    ? `Analyze this job/project lead and extract ONLY the following in JSON format:
- keySkills: array of required skills or keywords
- contactMethods: suggested ways to reach out (email, form, social profile)

Title: ${data.title}
Snippet: ${data.snippet}
Link: ${data.link}

Output ONLY valid JSON.`
    : `Analyze the following lead information extracted from a search result:
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

Output ONLY valid JSON.`;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const jsonString = responseText.replace(/```json|```/g, "").trim();
    const processedInfo = JSON.parse(jsonString);

    // Never overwrite priority/matchReason/projectType already set by reranking
    if (alreadyScored) {
      delete processedInfo.priority;
      delete processedInfo.projectType;
    }

    await snapshot.ref.update({
      ...processedInfo,
      status: "processed",
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("Gemini processing error:", error);
    await snapshot.ref.update({
      status: "processed",
      aiError: (error as Error).message,
    });
  }
});
