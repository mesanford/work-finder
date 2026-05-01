# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

**Next.js app (root):**
```bash
npm run dev        # dev server on port 3000
npm run build      # production build
npm run lint       # ESLint
```

**Cloud Functions (`functions/`):**
```bash
npm run build        # compile TypeScript → lib/
npm run build:watch  # watch mode
npm run serve        # build + start Firebase emulator
npm run deploy       # deploy to Firebase
```

There are no automated tests in this codebase.

## Architecture

Work Finder is an AI-powered lead discovery and pipeline management tool. It has two independent deployable units:

**1. Next.js app** (Firebase App Hosting) — frontend + API routes  
**2. Firebase Cloud Functions** (`functions/`) — background jobs and scheduled tasks

These share the same Firestore database and Firebase project but are built and deployed independently.

### Data Flow

1. User creates a **Search Profile** (keywords, project types, company criteria)
2. `searchProjects` Cloud Function reads the user's Knowledge Base (resume + portfolio + boilerplate), generates 5–20 diverse Google search queries via Gemini with a thinking budget, runs them concurrently (2 at a time to respect RPM), validates/deduplicates URLs, reranks against the user's profile, and batch-writes new leads to Firestore
3. `processLeadOnCreate` Firestore trigger fires on each new lead, runs Gemini extraction to populate metadata (skills, company, contact methods, priority 1–5)
4. `scheduledDailySearch` runs all profiles daily
5. The Next.js dashboard reads leads via `onSnapshot()` real-time listeners

### Key Source Locations

| Path | Role |
|------|------|
| `src/app/page.tsx` | Main dashboard (~3500 lines): lead grid, filters, search bar, profile sidebar |
| `src/app/lead/[id]/page.tsx` | Lead detail: pipeline status, AI proposal chat, notes |
| `src/app/knowledge/page.tsx` | Knowledge Base CRUD |
| `src/app/api/search-jobs/route.ts` | Manual search: query expansion + parallel Gemini web search |
| `src/app/api/lead-from-url/route.ts` | Extract lead metadata from a URL |
| `src/app/api/generate-proposal/route.ts` | AI proposal generation using KB context |
| `functions/src/index.ts` | All Cloud Functions (searchProjects, processLeadOnCreate, scheduledDailySearch) |
| `src/lib/firebase.ts` | Firebase SDK init (Auth, Firestore, Storage) |
| `src/lib/pipeline.ts` | Pipeline stage definitions and ordering |
| `src/context/AuthContext.tsx` | Firebase Auth provider |

### Firestore Schema

All collections are scoped by `userId`:

- **`leads`** — `{ title, link, status, priority (1–5), projectType, companyInfo, keySkills, source, query, createdAt, proposalSentAt }`
- **`searchProfiles`** — `{ keywords, projectTypes, companyTypes, companySizes, sources, maxResults }`
- **`knowledgeBase`** — `{ type: resume|portfolio|boilerplate|proposal_template|company_info|reference, title, content, fileUrl, tags }`
- **`leadChats`** — `{ leadId, messages[], createdAt }`

Security rules enforce `userId == auth.uid` on all reads/writes.

### AI / Gemini Patterns

- Primary model: `gemini-2.0-flash`, fallback: `gemini-2.5-flash`
- `generateWithBackoff()` in `functions/src/index.ts` handles rate limits with exponential backoff (`2^attempt * 1000 + random jitter`)
- Query generation and reranking use `thinkingConfig: { thinkingBudget: 2000 }`
- `runConcurrent()` limits parallel Gemini calls to 2 to stay within RPM limits
- API routes in the Next.js app use `@google/generative-ai` directly (not the Functions SDK)

### Environment / Secrets

- `NEXT_PUBLIC_FIREBASE_*` — Firebase client config (in `.env.local`, not committed)
- `GEMINI_API_KEY` — injected at runtime via Firebase Params (`defineSecret()`), referenced in `apphosting.yaml`

### Infrastructure

- **Firebase App Hosting** (`apphosting.yaml`): 0–10 instances, 512 MB RAM
- **Firestore** region: `nam5`
- **Custom indexes** in `firestore.indexes.json` (required for multi-field queries with ordering)
- Path alias `@/*` → `src/*` (configured in `tsconfig.json`)
