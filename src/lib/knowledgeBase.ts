/**
 * Knowledge Base — types, category definitions, and helpers.
 *
 * Each entry is stored in the top-level `knowledgeBase` Firestore collection
 * scoped by `userId` (same pattern as `leads`).
 */

import { Timestamp } from "firebase/firestore";

/* ─── Entry Types ─── */

export const KB_ENTRY_TYPES = [
  { key: "company_info",       label: "Company Info",       icon: "Building2",   color: "bg-blue-100 text-blue-700 border-blue-200" },
  { key: "proposal_template",  label: "Proposal Template",  icon: "FileText",    color: "bg-violet-100 text-violet-700 border-violet-200" },
  { key: "resume",             label: "Resume / CV",        icon: "UserCircle",  color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  { key: "portfolio",          label: "Portfolio / Case Study", icon: "Briefcase", color: "bg-amber-100 text-amber-700 border-amber-200" },
  { key: "boilerplate",        label: "Boilerplate / Legal", icon: "Shield",     color: "bg-slate-100 text-slate-700 border-slate-200" },
  { key: "reference",          label: "Reference Material",  icon: "BookOpen",   color: "bg-rose-100 text-rose-700 border-rose-200" },
] as const;

export type KBEntryType = (typeof KB_ENTRY_TYPES)[number]["key"];

export function getEntryType(key?: string) {
  return KB_ENTRY_TYPES.find((t) => t.key === key) ?? KB_ENTRY_TYPES[0];
}

/* ─── Entry Model ─── */

export interface KnowledgeEntry {
  id?: string;
  userId: string;
  type: KBEntryType;
  title: string;
  content: string;         // Full text body — used by AI
  fileUrl?: string;        // Firebase Storage download URL
  fileName?: string;       // Original filename
  fileType?: string;       // MIME type
  fileSizeBytes?: number;
  source: "manual" | "upload" | "google_drive";
  tags: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* ─── Helpers ─── */

/** Parse a comma-separated tag string into a trimmed array. */
export function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Format file size in human-readable form. */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Allowed MIME types for uploads. */
export const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

/** Max upload size: 10 MB */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
