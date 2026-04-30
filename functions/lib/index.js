"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processLeadOnCreate = exports.scheduledDailySearch = exports.searchProjects = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const generative_ai_1 = require("@google/generative-ai");
const params_1 = require("firebase-functions/params"); // v2
const RETRYABLE = (err) => {
    const msg = err?.message || "";
    const status = err?.status || err?.response?.status;
    return msg.includes("429") || msg.includes("503") || status === 429 || status === 503;
};
const SKIP_MODEL = (err) => {
    const msg = err?.message || "";
    return msg.includes("404") || msg.includes("not found");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function generateWithBackoff(genAI, models, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
tools, prompt, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
generationConfig = {}, maxRetries = 2) {
    let lastError;
    for (const modelName of models) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName, tools, generationConfig });
                return await model.generateContent(prompt);
            }
            catch (err) {
                lastError = err;
                if (SKIP_MODEL(err))
                    break;
                if (!RETRYABLE(err))
                    throw err;
                if (attempt < maxRetries - 1)
                    await sleep(Math.pow(2, attempt) * 1000 + Math.random() * 1000);
            }
        }
    }
    throw lastError;
}
async function runConcurrent(tasks, limit) {
    const results = [];
    for (let i = 0; i < tasks.length; i += limit) {
        const chunk = tasks.slice(i, i + limit);
        const chunkResults = await Promise.allSettled(chunk.map((t) => t()));
        results.push(...chunkResults);
    }
    return results;
}
function parseJsonArray(text) {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end <= start)
        return [];
    try {
        return JSON.parse(text.slice(start, end + 1));
    }
    catch {
        return [];
    }
}
// Patterns that identify search results pages rather than individual job listings
const SEARCH_PAGE_PATTERNS = [
    /[?&](q|query|search|keywords?|k|what|term|jobtitle|l|location)=/i,
    /\/jobs\/search/i,
    /\/job-search/i,
    /\/jobs-search/i,
    /\/search\?(.*)(job|role|position)/i,
    /\/results(\?|\/)/i,
    /\/find(\?|\/jobs)/i,
    /\/vacancies\?/i,
    /\/positions\?/i,
    /\/jobs\?((?!id=|jk=|jobid=).)*$/i, // job board search params but not individual-job params
];
function isSearchResultPage(url) {
    return SEARCH_PAGE_PATTERNS.some((p) => p.test(url));
}
async function isLinkValid(url) {
    if (isSearchResultPage(url))
        return false;
    try {
        const res = await fetch(url, {
            method: "HEAD",
            redirect: "follow",
            signal: AbortSignal.timeout(4000),
        });
        if (!res.ok)
            return false;
        const final = new URL(res.url);
        if (isSearchResultPage(final.href))
            return false;
        return final.pathname.length > 1;
    }
    catch {
        return false;
    }
}
admin.initializeApp();
const GEMINI_API_KEY = (0, params_1.defineSecret)("GEMINI_API_KEY");
const SUPPLY_EXCLUSIONS = `-site:fiverr.com -site:upwork.com/freelancers -site:freelancer.com/u -"available for hire" -"I will"`;
async function runSearchPipeline(profile, genAI, db) {
    const { userId, keywords = [], projectTypes = [], companyTypes = [] } = profile;
    const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
    const noThinkConfig = { thinkingConfig: { thinkingBudget: 0 } };
    const searchTools = [{ googleSearch: {} }];
    // Stage 1: KB Profile Build
    let profileText = "";
    try {
        const kbSnap = await db
            .collection("knowledgeBase")
            .where("userId", "==", userId)
            .where("type", "in", ["resume", "portfolio", "boilerplate"])
            .get();
        profileText = kbSnap.docs
            .map((d) => `[${d.data().type}] ${d.data().title}:\n${d.data().content}`)
            .join("\n\n")
            .slice(0, 3000);
    }
    catch (err) {
        console.error("KB read failed, proceeding without profile:", err);
    }
    // Stage 2: Query Generation
    let queries = [];
    if (profileText && keywords.length > 0) {
        const typeFilter = projectTypes.length ? `Project types: ${projectTypes.join(", ")}` : "";
        const companyFilter = companyTypes.length ? `Company types: ${companyTypes.join(", ")}` : "";
        const queryGenPrompt = `You are helping a senior technology contractor find paid work opportunities.

Contractor profile:
${profileText}

Search criteria:
- Keywords: ${keywords.join(", ")}
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
        }
        catch (err) {
            console.error("Query generation failed:", err);
        }
    }
    if (queries.length === 0) {
        queries = [`${keywords.join(" ")} contract opportunity hiring ${SUPPLY_EXCLUSIONS}`];
    }
    // Stage 3: Concurrency-limited grounded search (2 at a time to stay within RPM)
    const searchResults = await runConcurrent(queries.map((q) => () => generateWithBackoff(genAI, models, searchTools, `Search for currently open individual job postings and contract opportunities matching: "${q}"

CRITICAL URL RULES — each link MUST:
- Point to a single, specific job listing page (e.g. linkedin.com/jobs/view/1234567890, indeed.com/viewjob?jk=abc, lever.co/company/job-title)
- NOT be a search results page (reject any URL containing /search, /jobs/search, ?q=, ?query=, ?keywords=, ?search=)
- NOT be a homepage or category page

Return ONLY a valid JSON array of objects with:
- title: The job/project title
- link: The direct deep-link URL to the individual posting
- snippet: A 1-2 sentence description

If you cannot find a verified deep link to an individual posting, omit that result entirely.
Return ONLY the JSON array.`, noThinkConfig, 2)), 2);
    const seen = new Set();
    const allItems = [];
    for (const result of searchResults) {
        if (result.status === "rejected")
            continue;
        const items = parseJsonArray(result.value.response.text());
        for (const item of items) {
            if (item.link && !seen.has(item.link)) {
                seen.add(item.link);
                allItems.push(item);
            }
        }
    }
    const validationResults = await Promise.allSettled(allItems.map((item) => isLinkValid(item.link)));
    const validated = allItems.filter((_, i) => {
        const r = validationResults[i];
        return r.status === "fulfilled" && r.value;
    });
    if (validated.length === 0) {
        return { count: 0, duplicatesSkipped: 0 };
    }
    // Stage 4: Reranking
    let rankedItems = validated;
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
            if (reranked.length > 0)
                rankedItems = reranked;
        }
        catch (err) {
            console.error("Reranking failed, using unranked validated results:", err);
        }
    }
    // Deduplicate and save
    const leadsCollection = db.collection("leads");
    const existingLeads = await leadsCollection.where("userId", "==", userId).get();
    const existingLinks = new Set(existingLeads.docs.map((d) => d.data().link));
    let count = 0;
    let duplicatesSkipped = 0;
    const batch = db.batch();
    for (const item of rankedItems) {
        if (!item.link || existingLinks.has(item.link)) {
            duplicatesSkipped++;
            continue;
        }
        const docRef = leadsCollection.doc();
        batch.set(docRef, {
            title: item.title || keywords.join(", "),
            link: item.link,
            snippet: item.snippet || "",
            source: "google_search",
            status: "new",
            userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            query: keywords.join(", "),
            priority: item.priority ?? null,
            matchReason: item.matchReason ?? null,
            projectType: item.projectType ?? (projectTypes.length ? projectTypes[0] : null),
            companyInfo: item.companyInfo ?? (companyTypes.length ? companyTypes[0] : null),
        });
        count++;
    }
    if (count > 0) {
        await batch.commit();
    }
    return { count, duplicatesSkipped };
}
exports.searchProjects = (0, https_1.onCall)({ secrets: [GEMINI_API_KEY], timeoutSeconds: 300 }, async (request) => {
    const { query, keywords, projectTypes, companyTypes, userId } = request.data;
    const searchKeywords = keywords || (query ? [query] : []);
    if (searchKeywords.length === 0) {
        throw new https_1.HttpsError("invalid-argument", "Query or keywords are required");
    }
    const targetUserId = userId || request.auth?.uid;
    if (!targetUserId) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const genAI = new generative_ai_1.GoogleGenerativeAI(GEMINI_API_KEY.value());
    const db = admin.firestore();
    const { count, duplicatesSkipped } = await runSearchPipeline({ userId: targetUserId, keywords: searchKeywords, projectTypes, companyTypes }, genAI, db);
    return { success: true, count, duplicatesSkipped };
});
exports.scheduledDailySearch = (0, scheduler_1.onSchedule)({ schedule: "every 24 hours", secrets: [GEMINI_API_KEY], timeoutSeconds: 540 }, async () => {
    const db = admin.firestore();
    const genAI = new generative_ai_1.GoogleGenerativeAI(GEMINI_API_KEY.value());
    const profilesSnap = await db.collection("searchProfiles").get();
    if (profilesSnap.empty) {
        console.log("No search profiles found, skipping scheduled search.");
        return;
    }
    let totalNew = 0;
    let totalDups = 0;
    for (const profileDoc of profilesSnap.docs) {
        const data = profileDoc.data();
        const profile = {
            id: profileDoc.id,
            userId: data.userId,
            keywords: data.keywords || [],
            projectTypes: data.projectTypes || [],
            companyTypes: data.companyTypes || [],
        };
        if (!profile.userId || !profile.keywords?.length)
            continue;
        try {
            const { count, duplicatesSkipped } = await runSearchPipeline(profile, genAI, db);
            totalNew += count;
            totalDups += duplicatesSkipped;
            await profileDoc.ref.update({ lastSearchedAt: admin.firestore.FieldValue.serverTimestamp() });
            console.log(`Profile ${profileDoc.id} (${profile.userId}): +${count} leads, ${duplicatesSkipped} dups`);
        }
        catch (err) {
            console.error(`Failed to run pipeline for profile ${profileDoc.id}:`, err);
        }
    }
    console.log(`Scheduled search complete: ${totalNew} new leads, ${totalDups} duplicates skipped.`);
});
exports.processLeadOnCreate = (0, firestore_1.onDocumentCreated)({ document: "leads/{leadId}", secrets: [GEMINI_API_KEY] }, async (event) => {
    const snapshot = event.data;
    if (!snapshot)
        return;
    const data = snapshot.data();
    if (data.status !== "new")
        return;
    const genAI = new generative_ai_1.GoogleGenerativeAI(GEMINI_API_KEY.value());
    const processModels = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
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
        const result = await generateWithBackoff(genAI, processModels, [], prompt, {}, 2);
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
    }
    catch (error) {
        console.error("Gemini processing error:", error);
        await snapshot.ref.update({
            status: "processed",
            aiError: error.message,
        });
    }
});
//# sourceMappingURL=index.js.map