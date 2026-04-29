"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processLeadOnCreate = exports.searchProjects = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const generative_ai_1 = require("@google/generative-ai");
const params_1 = require("firebase-functions/params");
admin.initializeApp();
const GEMINI_API_KEY = (0, params_1.defineString)("GEMINI_API_KEY");
exports.searchProjects = (0, https_1.onCall)(async (request) => {
    const { query, keywords, projectTypes, companyTypes, userId } = request.data;
    // Support both direct query and profile-based search
    const searchQuery = query || (keywords ? keywords.join(" ") : null);
    if (!searchQuery) {
        throw new https_1.HttpsError("invalid-argument", "Query or keywords are required");
    }
    // Use the user's ID if provided, otherwise the auth context
    const targetUserId = userId || request.auth?.uid;
    if (!targetUserId) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    try {
        const genAI = new generative_ai_1.GoogleGenerativeAI(GEMINI_API_KEY.value());
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            tools: [{ googleSearchRetrieval: {} }],
        });
        const prompt = `Search for project opportunities, contracts, RFPs, and job postings matching: "${searchQuery}".
Return ONLY a valid JSON array of up to 10 results, each with:
- title: the page or posting title
- link: the full URL
- snippet: a 1-2 sentence description
Output ONLY the JSON array, no markdown.`;
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const jsonString = responseText.replace(/```json|```/g, "").trim();
        const items = JSON.parse(jsonString);
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
                title: item.title,
                link: item.link,
                snippet: item.snippet,
                source: "google_search",
                status: "new",
                userId: targetUserId,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                query: searchQuery,
                // Include profile metadata if available
                projectType: projectTypes ? projectTypes[0] : null,
                companyInfo: companyTypes ? companyTypes[0] : null,
            });
            count++;
        });
        if (count > 0) {
            await batch.commit();
        }
        return { success: true, count, duplicatesSkipped };
    }
    catch (error) {
        console.error("Search error:", error);
        throw new https_1.HttpsError("internal", error.message);
    }
});
exports.processLeadOnCreate = (0, firestore_1.onDocumentCreated)("leads/{leadId}", async (event) => {
    const snapshot = event.data;
    if (!snapshot)
        return;
    const data = snapshot.data();
    // Only process new leads that haven't been processed yet
    if (data.status !== "new")
        return;
    const genAI = new generative_ai_1.GoogleGenerativeAI(GEMINI_API_KEY.value());
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
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
    }
    catch (error) {
        console.error("Gemini processing error:", error);
        // Don't mark as error if it's just a parse failure, maybe it's not a valid lead
        // But update status so we don't keep trying
        await snapshot.ref.update({
            status: "processed", // Move past 'new' even if AI fails
            aiError: error.message,
        });
    }
});
//# sourceMappingURL=index.js.map