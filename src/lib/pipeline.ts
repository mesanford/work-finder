/**
 * Lead Pipeline — stage definitions, colors, and ordering.
 *
 * Stages move left-to-right:
 *   new → reviewing → shortlisted → proposal_sent → won / lost / archived
 */

export const PIPELINE_STAGES = [
  { key: "new",           label: "New",           color: "bg-sky-100    text-sky-700    border-sky-200",    dot: "bg-sky-500" },
  { key: "reviewing",     label: "Reviewing",     color: "bg-amber-50   text-amber-700  border-amber-200",  dot: "bg-amber-500" },
  { key: "shortlisted",   label: "Shortlisted",   color: "bg-violet-50  text-violet-700 border-violet-200", dot: "bg-violet-500" },
  { key: "proposal_sent", label: "Proposal Sent", color: "bg-blue-50    text-blue-700   border-blue-200",   dot: "bg-blue-500" },
  { key: "won",           label: "Won",           color: "bg-emerald-50 text-emerald-700 border-emerald-200",dot: "bg-emerald-500" },
  { key: "lost",          label: "Lost",          color: "bg-gray-100   text-gray-500   border-gray-200",   dot: "bg-gray-400" },
  { key: "archived",      label: "Archived",      color: "bg-gray-50    text-gray-400   border-gray-200",   dot: "bg-gray-300" },
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number]["key"];

/** Look up a stage object by key. Falls back to "new". */
export function getStage(key?: string) {
  return PIPELINE_STAGES.find((s) => s.key === key) ?? PIPELINE_STAGES[0];
}

/** All "active" (non-terminal) stages for filter dropdowns. */
export const ACTIVE_STAGES = PIPELINE_STAGES.filter(
  (s) => !["won", "lost", "archived"].includes(s.key)
);

/** Sort options for the leads grid. */
export const SORT_OPTIONS = [
  { key: "date_desc",     label: "Newest first" },
  { key: "date_asc",      label: "Oldest first" },
  { key: "priority_desc", label: "Highest priority" },
  { key: "priority_asc",  label: "Lowest priority" },
  { key: "company_asc",   label: "Company A → Z" },
  { key: "company_desc",  label: "Company Z → A" },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]["key"];
