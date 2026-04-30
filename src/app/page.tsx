"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection, query, orderBy, where, onSnapshot, addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { signOut } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import { getFunctions } from "firebase/functions";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import LeadCard from "@/components/LeadCard";
import SearchProfileSidebar from "@/components/SearchProfileSidebar";
import {
  Search, Loader2, Plus, Filter, LogOut, ChevronLeft,
  ChevronRight, X, Briefcase, ArrowUpDown, BookOpen,
} from "lucide-react";
import { PIPELINE_STAGES, SORT_OPTIONS, type SortKey } from "@/lib/pipeline";

const LEADS_PER_PAGE = 12;

interface FilterState {
  status: string;
  source: string;
  minPriority: number;
  textSearch: string;
}

const DEFAULT_FILTERS: FilterState = {
  status: "all",
  source: "all",
  minPriority: 0,
  textSearch: "",
};

export default function Dashboard() {
  const { user, loading } = useAuth();
  const [leads, setLeads] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchFeedback, setSearchFeedback] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sortBy, setSortBy] = useState<SortKey>("date_desc");
  const [showSidebar, setShowSidebar] = useState(true);
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, "leads"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const stringify = (v: any) => {
        if (!v) return null;
        if (typeof v === "string") return v;
        if (typeof v === "object") return v.name || v.type || v.label || JSON.stringify(v);
        return String(v);
      };
      const leadsData = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          companyInfo: stringify(data.companyInfo),
          projectType: stringify(data.projectType),
        };
      });
      setLeads(leadsData);
    });

    return () => unsubscribe();
  }, [user]);

  // Filter + sort (memoised)
  const filteredAndSorted = useMemo(() => {
    let result = leads.filter((lead) => {
      // Status filter
      if (filters.status !== "all" && lead.status !== filters.status) return false;
      // Source filter
      if (filters.source !== "all" && lead.source !== filters.source) return false;
      // Priority filter
      if (filters.minPriority > 0 && (lead.priority || 0) < filters.minPriority) return false;
      // Text search (title, company, description, skills)
      if (filters.textSearch.trim()) {
        const q = filters.textSearch.toLowerCase();
        const stringify = (v: any) => {
          if (!v) return "";
          if (typeof v === "string") return v;
          if (typeof v === "object") return v.name || v.type || v.label || JSON.stringify(v);
          return String(v);
        };
        const haystack = [
          lead.title, stringify(lead.companyInfo), lead.description,
          lead.snippet, stringify(lead.projectType),
          ...(lead.keySkills || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    // Sort
    result.sort((a, b) => {
      const stringify = (v: any) => {
        if (!v) return "";
        if (typeof v === "string") return v;
        if (typeof v === "object") return v.name || v.type || v.label || JSON.stringify(v);
        return String(v);
      };
      switch (sortBy) {
        case "date_desc":
          return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
        case "date_asc":
          return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
        case "priority_desc":
          return (b.priority || 0) - (a.priority || 0);
        case "priority_asc":
          return (a.priority || 0) - (b.priority || 0);
        case "company_asc":
          return stringify(a.companyInfo).localeCompare(stringify(b.companyInfo));
        case "company_desc":
          return stringify(b.companyInfo).localeCompare(stringify(a.companyInfo));
        default:
          return 0;
      }
    });

    return result;
  }, [leads, filters, sortBy]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSorted.length / LEADS_PER_PAGE);
  const paginatedLeads = filteredAndSorted.slice(
    (currentPage - 1) * LEADS_PER_PAGE,
    currentPage * LEADS_PER_PAGE
  );

  // Reset to page 1 when filters/sort change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters, sortBy]);

  // Pipeline stage counts for sidebar badges
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of PIPELINE_STAGES) {
      counts[s.key] = leads.filter((l) => (l.status || "new") === s.key).length;
    }
    return counts;
  }, [leads]);

  // Free-text Google search
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchFeedback("");
    try {
      const functions = getFunctions();
      const searchProjectsFn = httpsCallable(functions, "searchProjects");
      const result: any = await searchProjectsFn({ query: searchQuery });
      const { count, duplicatesSkipped } = result.data;
      setSearchFeedback(
        `Found ${count} new lead${count !== 1 ? "s" : ""}${
          duplicatesSkipped ? ` (${duplicatesSkipped} duplicates skipped)` : ""
        }`
      );
      setSearchQuery("");
    } catch (error) {
      console.error("Search error:", error);
      setSearchFeedback("Search failed. Check your API key configuration.");
    } finally {
      setIsSearching(false);
      setTimeout(() => setSearchFeedback(""), 5000);
    }
  };

  // Profile-based search (Google + optional job board)
  const handleProfileSearch = async (profile: any) => {
    if (!user) return;
    setIsSearching(true);
    setSearchFeedback("");

    let totalNew = 0;
    let totalDups = 0;
    const errors: string[] = [];

    try {
      // 1. Google Custom Search
      if (profile.sources.includes("google_search")) {
        try {
          const functions = getFunctions();
          const searchProjectsFn = httpsCallable(functions, "searchProjects");
          const result: any = await searchProjectsFn({
            keywords: profile.keywords,
            projectTypes: profile.projectTypes,
            companyTypes: profile.companyTypes,
          });
          totalNew += result.data.count || 0;
          totalDups += result.data.duplicatesSkipped || 0;
        } catch (err: any) {
          errors.push("Google Search failed");
          console.error("Google search error:", err);
        }
      }

      // 2. Job Board search via API route
      if (profile.sources.includes("job_boards")) {
        try {
          const res = await fetch("/api/search-jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              keywords: profile.keywords,
              projectTypes: profile.projectTypes,
              companyTypes: profile.companyTypes,
              companySizes: profile.companySizes,
            }),
          });

          if (!res.ok) throw new Error("Job search API failed");

          const { jobs } = await res.json();

          if (jobs?.length) {
            // Check for existing links to deduplicate
            const existingLinks = new Set(leads.map((l) => l.link));
            const newJobs = jobs.filter((j: any) => j.link && !existingLinks.has(j.link));

            // Save new jobs to Firestore as leads
            for (const job of newJobs) {
              await addDoc(collection(db, "leads"), {
                title: job.title || "Untitled Job",
                link: job.link || "",
                snippet: job.snippet || "",
                source: "job_board",
                status: "new",
                userId: user.uid,
                companyInfo: job.company || null,
                projectType: job.projectType || null,
                createdAt: serverTimestamp(),
                query: (profile.keywords || []).join(", "),
              });
            }

            totalNew += newJobs.length;
            totalDups += jobs.length - newJobs.length;
          }
        } catch (err: any) {
          errors.push("Job Board search failed");
          console.error("Job search error:", err);
        }
      }

      let msg = `Found ${totalNew} new lead${totalNew !== 1 ? "s" : ""}`;
      if (totalDups > 0) msg += ` (${totalDups} duplicates skipped)`;
      if (errors.length > 0) msg += ` — ${errors.join(", ")}`;
      setSearchFeedback(msg);
    } catch (err) {
      setSearchFeedback("Search failed. Please try again.");
      console.error("Profile search error:", err);
    } finally {
      setIsSearching(false);
      setTimeout(() => setSearchFeedback(""), 8000);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  const hasActiveFilters = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin text-blue-600" size={48} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-extrabold text-blue-600">Work Finder</h1>
            <span className="hidden sm:inline-flex px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[10px] font-bold uppercase tracking-wider">
              Beta
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 hidden sm:block">{user.email}</span>
            <Link
              href="/knowledge"
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-indigo-600 px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors font-medium"
            >
              <BookOpen size={14} />
              <span className="hidden sm:inline">Knowledge Base</span>
            </Link>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex gap-6">
          {/* Sidebar */}
          {showSidebar && (
            <aside className="w-72 flex-shrink-0 hidden lg:block space-y-4">
              <SearchProfileSidebar
                onRunSearch={handleProfileSearch}
                isSearching={isSearching}
              />

              {/* Pipeline overview */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Pipeline</h3>
                <div className="space-y-1">
                  {PIPELINE_STAGES.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => {
                        setFilters({
                          ...filters,
                          status: filters.status === s.key ? "all" : s.key,
                        });
                        setShowFilters(true);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        filters.status === s.key
                          ? `${s.color} border`
                          : "text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                        {s.label}
                      </span>
                      <span className={`text-[10px] font-bold ${
                        stageCounts[s.key] > 0 ? "text-gray-700" : "text-gray-300"
                      }`}>
                        {stageCounts[s.key]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick stats */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Overview</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center p-2 bg-blue-50 rounded-lg">
                    <p className="text-xl font-bold text-blue-700">{leads.length}</p>
                    <p className="text-[10px] text-blue-500 font-medium">Total Leads</p>
                  </div>
                  <div className="text-center p-2 bg-emerald-50 rounded-lg">
                    <p className="text-xl font-bold text-emerald-700">
                      {leads.filter((l) => l.status === "won").length}
                    </p>
                    <p className="text-[10px] text-emerald-500 font-medium">Won</p>
                  </div>
                  <div className="text-center p-2 bg-amber-50 rounded-lg">
                    <p className="text-xl font-bold text-amber-700">
                      {leads.filter((l) => (l.priority || 0) >= 4).length}
                    </p>
                    <p className="text-[10px] text-amber-500 font-medium">High Priority</p>
                  </div>
                  <div className="text-center p-2 bg-violet-50 rounded-lg">
                    <p className="text-xl font-bold text-violet-700">
                      {leads.filter((l) => l.status === "proposal_sent").length}
                    </p>
                    <p className="text-[10px] text-violet-500 font-medium">Proposals</p>
                  </div>
                </div>
              </div>
            </aside>
          )}

          {/* Main content */}
          <main className="flex-1 min-w-0">
            {/* Search bar */}
            <form onSubmit={handleSearch} className="mb-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="text"
                    placeholder="Quick search (e.g., 'React developer contract', 'Government software RFP')"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSearching || !searchQuery.trim()}
                  className="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:bg-blue-300 flex items-center gap-2 text-sm transition-colors"
                >
                  {isSearching ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                  Search
                </button>
              </div>
            </form>

            {/* Search feedback */}
            {searchFeedback && (
              <div className={`mb-4 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${
                searchFeedback.includes("failed")
                  ? "bg-red-50 text-red-700 border border-red-200"
                  : "bg-emerald-50 text-emerald-700 border border-emerald-200"
              }`}>
                {searchFeedback}
                <button onClick={() => setSearchFeedback("")} className="ml-auto">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Toolbar: title, filters, sort */}
            <div className="flex items-center justify-between mb-4 gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-gray-900">
                  Leads
                  <span className="ml-1.5 text-sm font-normal text-gray-400">
                    ({filteredAndSorted.length}{filteredAndSorted.length !== leads.length ? ` of ${leads.length}` : ""})
                  </span>
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {/* Sort */}
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortKey)}
                    className="appearance-none pl-7 pr-8 py-1.5 border border-gray-200 rounded-lg text-xs font-medium bg-white text-gray-600 hover:bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </select>
                  <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>

                {/* Filter toggle */}
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors ${
                    showFilters || hasActiveFilters
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <Filter size={14} />
                  Filter
                  {hasActiveFilters && (
                    <span className="w-1.5 h-1.5 bg-blue-600 rounded-full" />
                  )}
                </button>

                {/* Mobile sidebar toggle */}
                <button
                  onClick={() => setShowSidebar(!showSidebar)}
                  className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-medium bg-white text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <Briefcase size={14} />
                  Profiles
                </button>
              </div>
            </div>

            {/* Filter panel */}
            {showFilters && (
              <div className="mb-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                <div className="flex flex-wrap gap-4 items-end">
                  {/* Text search */}
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Search within leads</label>
                    <input
                      type="text"
                      value={filters.textSearch}
                      onChange={(e) => setFilters({ ...filters, textSearch: e.target.value })}
                      placeholder="Filter by title, company, skills…"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Status</label>
                    <select
                      value={filters.status}
                      onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Stages</option>
                      {PIPELINE_STAGES.map((s) => (
                        <option key={s.key} value={s.key}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Source</label>
                    <select
                      value={filters.source}
                      onChange={(e) => setFilters({ ...filters, source: e.target.value })}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Sources</option>
                      <option value="google_search">Web Search</option>
                      <option value="job_board">Job Board</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Min Priority</label>
                    <select
                      value={filters.minPriority}
                      onChange={(e) => setFilters({ ...filters, minPriority: Number(e.target.value) })}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={0}>Any</option>
                      <option value={2}>★★ and above</option>
                      <option value={3}>★★★ and above</option>
                      <option value={4}>★★★★ and above</option>
                      <option value={5}>★★★★★ only</option>
                    </select>
                  </div>
                  {hasActiveFilters && (
                    <button
                      onClick={() => setFilters(DEFAULT_FILTERS)}
                      className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      Clear All
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Leads grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {paginatedLeads.map((lead) => (
                <LeadCard key={lead.id} lead={lead} />
              ))}
              {filteredAndSorted.length === 0 && !isSearching && (
                <div className="col-span-full py-16 text-center bg-white rounded-xl border-2 border-dashed border-gray-200">
                  <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Search size={24} className="text-gray-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-1">No leads found</h3>
                  <p className="text-xs text-gray-400 max-w-sm mx-auto">
                    {leads.length > 0
                      ? "Try adjusting your filters to see more leads."
                      : "Create a search profile in the sidebar or use quick search above to find projects and jobs."}
                  </p>
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 7) {
                      pageNum = i + 1;
                    } else if (currentPage <= 4) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 3) {
                      pageNum = totalPages - 6 + i;
                    } else {
                      pageNum = currentPage - 3 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                          currentPage === pageNum
                            ? "bg-blue-600 text-white"
                            : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
