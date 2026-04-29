"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import {
  KB_ENTRY_TYPES, getEntryType, formatFileSize,
  type KnowledgeEntry,
} from "@/lib/knowledgeBase";
import KnowledgeEntryModal from "@/components/KnowledgeEntryModal";
import Link from "next/link";
import {
  Plus, Search, Loader2, ArrowLeft, BookOpen,
  Building2, FileText, UserCircle, Briefcase, Shield,
  Paperclip, Tag, MoreVertical, Edit3, Trash2,
} from "lucide-react";

/* Map icon keys to components */
const ICON_MAP: Record<string, React.ElementType> = {
  Building2, FileText, UserCircle, Briefcase, Shield, BookOpen,
};

export default function KnowledgeBasePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [modalEntry, setModalEntry] = useState<Partial<KnowledgeEntry> | null | undefined>(undefined);
  // undefined = closed, null = new entry, object = editing

  /* ─── Auth guard ─── */
  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [user, authLoading, router]);

  /* ─── Real-time listener ─── */
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "knowledgeBase"),
      where("userId", "==", user.uid),
      orderBy("updatedAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const items: KnowledgeEntry[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<KnowledgeEntry, "id">),
      }));
      setEntries(items);
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  /* ─── Filtered list ─── */
  const filtered = useMemo(() => {
    let result = entries;
    if (activeFilter !== "all") {
      result = result.filter((e) => e.type === activeFilter);
    }
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q) ||
          e.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    return result;
  }, [entries, activeFilter, searchText]);

  /* ─── CRUD handlers ─── */
  const handleSave = async (data: Partial<KnowledgeEntry>) => {
    if (!user) return;
    const now = Timestamp.now();

    if (modalEntry?.id) {
      // Update
      await updateDoc(doc(db, "knowledgeBase", modalEntry.id), {
        ...data,
        updatedAt: now,
      });
    } else {
      // Create
      await addDoc(collection(db, "knowledgeBase"), {
        ...data,
        userId: user.uid,
        createdAt: now,
        updatedAt: now,
      });
    }
  };

  const handleDelete = async () => {
    if (!modalEntry?.id) return;
    await deleteDoc(doc(db, "knowledgeBase", modalEntry.id));
  };

  /* ─── Category counts ─── */
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length };
    for (const t of KB_ENTRY_TYPES) {
      counts[t.key] = entries.filter((e) => e.type === t.key).length;
    }
    return counts;
  }, [entries]);

  /* ─── Loading ─── */
  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin text-indigo-600" size={48} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      {/* ─── Header ─── */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center">
                <BookOpen size={16} className="text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Knowledge Base</h1>
                <p className="text-[11px] text-gray-400 -mt-0.5">Company info, templates, & reference materials</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => setModalEntry(null)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 rounded-xl hover:from-indigo-700 hover:to-violet-700 transition-all shadow-sm"
          >
            <Plus size={16} /> Add Entry
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* ─── Search + Category Tabs ─── */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search entries…"
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-gray-400 bg-white"
            />
          </div>
        </div>

        {/* Category filter tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setActiveFilter("all")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
              activeFilter === "all"
                ? "bg-gray-900 text-white border-gray-900"
                : "text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            All{" "}
            <span className="ml-1 opacity-70">{typeCounts.all}</span>
          </button>
          {KB_ENTRY_TYPES.map((t) => {
            const Icon = ICON_MAP[t.icon] || FileText;
            const isActive = activeFilter === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveFilter(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                  isActive
                    ? `${t.color} border-current font-bold`
                    : "text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <Icon size={12} />
                {t.label}
                {typeCounts[t.key] > 0 && (
                  <span className="ml-0.5 opacity-70">{typeCounts[t.key]}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* ─── Content ─── */}
        {filtered.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center text-center py-20">
            <div className="w-20 h-20 bg-gradient-to-br from-indigo-100 to-violet-100 rounded-2xl flex items-center justify-center mb-5">
              <BookOpen size={36} className="text-indigo-500" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              {entries.length === 0 ? "Your Knowledge Base is empty" : "No matching entries"}
            </h3>
            <p className="text-sm text-gray-500 max-w-md mb-6">
              {entries.length === 0
                ? "Add your company information, proposal templates, resumes, and reference materials. Gemini will use this context to generate more accurate and personalized proposals."
                : "Try adjusting your search or filter criteria."}
            </p>
            {entries.length === 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
                {[
                  { label: "Add Company Info", type: "company_info" as const },
                  { label: "Add Proposal Template", type: "proposal_template" as const },
                  { label: "Add Resume / CV", type: "resume" as const },
                  { label: "Add Portfolio Piece", type: "portfolio" as const },
                ].map((s) => (
                  <button
                    key={s.type}
                    onClick={() => setModalEntry({ type: s.type })}
                    className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-left bg-white hover:bg-indigo-50 hover:text-indigo-700 border border-gray-200 hover:border-indigo-300 rounded-xl transition-all"
                  >
                    <Plus size={14} className="text-gray-400" />
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Card grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((entry) => {
              const entryType = getEntryType(entry.type);
              const Icon = ICON_MAP[entryType.icon] || FileText;
              return (
                <div
                  key={entry.id}
                  onClick={() => setModalEntry(entry)}
                  className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md hover:border-gray-300 transition-all cursor-pointer group"
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md border ${entryType.color}`}>
                      <Icon size={10} />
                      {entryType.label}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setModalEntry(entry); }}
                      className="p-1 text-gray-300 group-hover:text-gray-500 hover:bg-gray-100 rounded transition-colors"
                    >
                      <Edit3 size={14} />
                    </button>
                  </div>

                  {/* Title */}
                  <h3 className="text-sm font-bold text-gray-900 mb-1.5 line-clamp-1">{entry.title}</h3>

                  {/* Preview */}
                  <p className="text-xs text-gray-500 leading-relaxed line-clamp-3 mb-3">
                    {entry.content || "No text content — file only."}
                  </p>

                  {/* Footer */}
                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap gap-1">
                      {entry.tags?.slice(0, 3).map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[9px] font-medium">
                          {tag}
                        </span>
                      ))}
                      {(entry.tags?.length || 0) > 3 && (
                        <span className="text-[9px] text-gray-400">+{entry.tags!.length - 3}</span>
                      )}
                    </div>
                    {entry.fileName && (
                      <div className="flex items-center gap-1 text-[10px] text-gray-400">
                        <Paperclip size={10} />
                        {formatFileSize(entry.fileSizeBytes || 0)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Modal ─── */}
      {modalEntry !== undefined && (
        <KnowledgeEntryModal
          entry={modalEntry}
          onSave={handleSave}
          onDelete={modalEntry?.id ? handleDelete : undefined}
          onClose={() => setModalEntry(undefined)}
        />
      )}
    </div>
  );
}
