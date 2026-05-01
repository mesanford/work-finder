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
    /\/jobs\?((?!id=|jk=|jobid=).)*$/i,
    /\/career-search/i,
    /\/all-jobs/i,
];
function isSearchResultPage(url) {
    if (!url)
        return false;
    // Common deep link patterns that might trigger regex but are valid
    if (url.includes("linkedin.com/jobs/view/"))
        return false;
    if (url.includes("lever.co/") && url.split("/").length > 4)
        return false;
    if (url.includes("greenhouse.io/") && url.includes("/jobs/"))
        return false;
    return SEARCH_PAGE_PATTERNS.some((p) => p.test(url));
}
function isLinkValid(url) {
    if (!url)
        return false;
    try {
        const parsed = new URL(url);
        if (parsed.hostname.includes("fiverr.com") || parsed.hostname.includes("freelancer.com"))
            return false;
        if (parsed.pathname === "/" || parsed.pathname === "")
            return false;
    }
    catch {
        return false;
    }
    return !isSearchResultPage(url);
}
admin.initializeApp();
const GEMINI_API_KEY = (0, params_1.defineSecret)("GEMINI_API_KEY");
const SUPPLY_EXCLUSIONS = `-site:fiverr.com -site:upwork.com/freelancers -site:freelancer.com/u -"available for hire" -"I will" -"hire me" -"looking for work"`;
async function runSearchPipeline(profile, genAI, db, maxResults = 25) {
    const { userId, keywords = [], projectTypes = [], companyTypes = [] } = profile;
    const models = ["gemini-2.0-flash"];
    // Scale query count to hit maxResults; URL validation drops ~50%, so aim for 2× raw
    const numQueries = Math.min(Math.ceil(maxResults / 5), 20);
    const perQuery = Math.ceil((maxResults * 2) / numQueries);
    const noThinkConfig = { thinkingConfig: { thinkingBudget: 0 } };
    const thinkConfig = { thinkingConfig: { thinkingBudget: 2000 } };
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
        const queryGenPrompt = `You are a specialized lead generation assistant for a high-end contractor.

Contractor profile:
${profileText}

Search criteria:
- Keywords: ${keywords.join(", ")}
${typeFilter}
${companyFilter}

Generate exactly ${numQueries} diverse and distinct Google search queries to find DIRECT hiring opportunities (Demand-side).
Mix these strategies:
1. Site-specific for ATS: site:lever.co, site:greenhouse.io, site:boards.greenhouse.io
2. Professional boards: LinkedIn, Indeed, ZipRecruiter
3. Niche/Industry vertical: specific hubs for these skills
4. Direct "Looking for [role]" or "Hiring [role]" queries on public platforms

Rules:
- Append exclusions: ${SUPPLY_EXCLUSIONS}
- Ensure queries are from the BUYER perspective.
- Tailor to the specific stack mentioned in the profile.

Return ONLY a JSON array of exactly ${numQueries} strings.`;
        try {
            const queryGenResult = await generateWithBackoff(genAI, models, [], queryGenPrompt, thinkConfig, 2);
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
    const searchResults = await runConcurrent(queries.map((q) => () => generateWithBackoff(genAI, models, searchTools, `Search for currently open individual job postings for: "${q}"
Target: ${perQuery} deep links.

CRITICAL: Return ONLY links to specific job descriptions. 
REJECT: Search results, homepages, or category pages.
Exemplar: linkedin.com/jobs/view/..., *.lever.co/*/*, greenhouse.io/*/jobs/*

Return ONLY a valid JSON array of objects with: title, link, snippet.`, noThinkConfig, 2)), 2);
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
    const validated = allItems.filter((item) => isLinkValid(item.link));
    if (validated.length === 0) {
        return { count: 0, duplicatesSkipped: 0 };
    }
    // Stage 4: Reranking
    let rankedItems = validated;
    if (profileText) {
        const rerankPrompt = `Evaluate these opportunities for a technology contractor.

Contractor profile:
${profileText}

Evaluate fit and return a JSON array with:
- title, link, snippet (unchanged)
- priority: 1-5 (5 = perfect match)
- matchReason: one brief sentence on fit
- projectType: Contract, Freelance, RFP, Full-Time, etc.
- companyInfo: Company name and context

Opportunities:
${JSON.stringify(validated)}

Output ONLY valid JSON array.`;
        try {
            const rerankResult = await generateWithBackoff(genAI, models, [], rerankPrompt, thinkConfig, 2);
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
    const { query, keywords, projectTypes, companyTypes, userId, maxResults } = request.data;
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
    const { count, duplicatesSkipped } = await runSearchPipeline({ userId: targetUserId, keywords: searchKeywords, projectTypes, companyTypes }, genAI, db, Math.min(Math.max(maxResults || 25, 10), 100));
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
            maxResults: data.maxResults || 25,
        };
        if (!profile.userId || !profile.keywords?.length)
            continue;
        try {
            const { count, duplicatesSkipped } = await runSearchPipeline(profile, genAI, db, profile.maxResults);
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
    const processModels = ["gemini-2.0-flash"]; // Updated model name
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