import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { google } from "googleapis";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { defineString } from "firebase-functions/params";

admin.initializeApp();

const GOOGLE_SEARCH_API_KEY = defineString("GOOGLE_SEARCH_API_KEY");
const GOOGLE_SEARCH_CX = defineString("GOOGLE_SEARCH_CX");
const GEMINI_API_KEY = defineString("GEMINI_API_KEY");

const customsearch = google.customsearch("v1");

/**
 * searchProjects — Google Custom Search with deduplication.
 * Now accepts optional structured params from search profiles.
 */
export const searchProjects = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to search.");
  }

  const {
    query: rawQuery,
    keywords,
    projectTypes,
    companyTypes,
    startIndex,
  } = request.data;

  // Build the search query from either free text or structured params
  let searchQuery = rawQuery || "";
  if (keywords?.length) {
    searchQuery = keywords.join(" ") + (searchQuery ? ` ${searchQuery}` : "");
  }
  if (projectTypes?.length) {
    searchQuery += ` ${projectTypes.join(" OR ")}`;
  }
  if (companyTypes?.length) {
    searchQuery += ` ${companyTypes.join(" OR ")}`;
  }

  if (!searchQuery.trim()) {
    throw new HttpsError("invalid-argument", "A query or keywords are required");
  }

  const userId = request.auth.uid;

  try {
    const res = await customsearch.cse.list({
      auth: GOOGLE_SEARCH_API_KEY.value(),
      cx: GOOGLE_SEARCH_CX.value(),
      q: searchQuery,
      start: startIndex || 1, // pagination support
      num: 10,
    });

    const items = res.data.items || [];
    const leadsCollection = admin.firestore().collection("leads");

    // Deduplication: check which URLs already exist for this user
    const existingLinksSnap = await leadsCollection
      .where("userId", "==", userId)
      .where("link", "in", items.map((i) => i.link).filter(Boolean).slice(0, 10))
      .get();

    const existingLinks = new Set(existingLinksSnap.docs.map((d) => d.data().link));

    const newItems = items.filter((item) => item.link && !existingLinks.has(item.link));

    if (newItems.length === 0) {
      return { success: true, count: 0, duplicatesSkipped: items.length, totalResults: res.data.searchInformation?.totalResults };
    }

    const batch = admin.firestore().batch();
    newItems.forEach((item) => {
      const docRef = leadsCollection.doc();
      batch.set(docRef, {
        title: item.title,
        link: item.link,
        snippet: item.snippet,
        source: "google_search",
        status: "new",
        userId: userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        query: searchQuery,
      });
    });

    await batch.commit();

    return {
      success: true,
      count: newItems.length,
      duplicatesSkipped: items.length - newItems.length,
      totalResults: res.data.searchInformation?.totalResults,
    };
  } catch (error: any) {
    console.error("Search error:", error);
    throw new HttpsError("internal", error.message);
  }
});

/**
 * processLeadOnCreate — Gemini auto-enrichment on new leads.
 */
export const processLeadOnCreate = onDocumentCreated("leads/{leadId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const data = snapshot.data();
  if (data.status !== "new") return;

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
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
    - contactMethods: An object with optional fields: { email?: string, linkedIn?: string, webForm?: string, phone?: string }
    - priority: Scale of 1-5 based on how well it fits a software engineering company profile.

    Output ONLY valid JSON.
  `;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const jsonString = responseText.replace(/```json|```/g, "").trim();
    const processedInfo = JSON.parse(jsonString);

    await snapshot.ref.update({
      ...processedInfo,
      status: "reviewing",
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("Gemini processing error:", error);
    await snapshot.ref.update({
      status: "error",
      error: (error as Error).message,
    });
  }
});
