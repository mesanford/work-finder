"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processLeadOnCreate = exports.searchProjects = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const googleapis_1 = require("googleapis");
const generative_ai_1 = require("@google/generative-ai");
const params_1 = require("firebase-functions/params");
admin.initializeApp();
const GOOGLE_SEARCH_API_KEY = (0, params_1.defineString)("GOOGLE_SEARCH_API_KEY");
const GOOGLE_SEARCH_CX = (0, params_1.defineString)("GOOGLE_SEARCH_CX");
const GEMINI_API_KEY = (0, params_1.defineString)("GEMINI_API_KEY");
const customsearch = googleapis_1.google.customsearch("v1");
exports.searchProjects = (0, https_1.onCall)(async (request) => {
    const { query } = request.data;
    if (!query) {
        throw new https_1.HttpsError("invalid-argument", "Query is required");
    }
    try {
        const res = await customsearch.cse.list({
            auth: GOOGLE_SEARCH_API_KEY.value(),
            cx: GOOGLE_SEARCH_CX.value(),
            q: query,
        });
        const items = res.data.items || [];
        const leadsCollection = admin.firestore().collection("leads");
        const batch = admin.firestore().batch();
        items.forEach((item) => {
            const docRef = leadsCollection.doc();
            batch.set(docRef, {
                title: item.title,
                link: item.link,
                snippet: item.snippet,
                source: "google_search",
                status: "raw",
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                query: query,
            });
        });
        await batch.commit();
        return { success: true, count: items.length };
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
    if (data.status !== "raw")
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
    - keySkills: A list of required skills or keywords.
    - companyInfo: Name of the company and any size/type info if available.
    - contactMethods: Suggested ways to reach out (email, form, social profile).
    - priority: Scale of 1-5 based on how well it fits a software engineering company profile.

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
        await snapshot.ref.update({
            status: "error",
            error: error.message,
        });
    }
});
//# sourceMappingURL=index.js.map