"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  doc, updateDoc, deleteDoc, onSnapshot,
  collection, addDoc, query, orderBy, where, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useParams, useRouter } from "next/navigation";
import {
  Loader2, ArrowLeft, Send, Copy, Check, MessageSquare,
  Star, ExternalLink, Briefcase, User, Globe, Laptop,
  StickyNote, Save, Archive, Trash2, ChevronRight,
  RotateCcw, Sparkles, Bot, UserCircle,
  Mail, Link2 as Linkedin, Phone, Globe2, Search, FileText,
  BookOpen, ChevronDown, Database,
} from "lucide-react";
import Link from "next/link";
import { PIPELINE_STAGES, getStage } from "@/lib/pipeline";
import { KB_ENTRY_TYPES, getEntryType, type KnowledgeEntry } from "@/lib/knowledgeBase";

/* ─── Types ─── */
interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: any;
}

/* ─── Quick-action prompts ─── */
const QUICK_PROMPTS = [
  { label: "Draft proposal", prompt: "Draft a compelling proposal for this lead." },
  { label: "Write cold email", prompt: "Write a concise cold email to introduce our services for this opportunity." },
  { label: "LinkedIn message", prompt: "Write a short LinkedIn DM to initiate contact about this opportunity." },
  { label: "Pricing estimate", prompt: "Suggest a rough pricing structure/estimate for this project based on the lead details." },
];

export default function LeadDetailPage() {
  const { id } = useParams();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  /* Lead state */
  const [lead, setLead] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  /* Notes */
  const [notes, setNotes] = useState("");
  const [notesSaved, setNotesSaved] = useState(true);
  const [notesSaving, setNotesSaving] = useState(false);

  /* Knowledge Base context */
  const [kbEntries, setKbEntries] = useState<KnowledgeEntry[]>([]);
  const [selectedKbIds, setSelectedKbIds] = useState<Set<string>>(new Set());
  const [kbExpanded, setKbExpanded] = useState(true);
  const [kbLoading, setKbLoading] = useState(true);

  /* Chat state */
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  /* Contact methods */
  const [contactMethods, setContactMethods] = useState<any>(null);
  const [contactLoading, setContactLoading] = useState(false);

  /* Delete confirmation */
  const [confirmDelete, setConfirmDelete] = useState(false);

  const renderMetaValue = (val: any) => {
    if (!val) return "Unknown";
    if (typeof val === "string") return val;
    if (typeof val === "object") {
      return val.name || val.type || val.label || JSON.stringify(val);
    }
    return String(val);
  };

  /* ─── Knowledge Base listener ─── */
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
      setKbEntries(items);
      // Auto-select company_info entries on first load
      if (kbLoading) {
        const autoSelect = new Set<string>(
          items.filter((e) => e.type === "company_info").map((e) => e.id!)
        );
        setSelectedKbIds(autoSelect);
      }
      setKbLoading(false);
    });
    return () => unsub();
  }, [user, kbLoading]);

  /* ─── Build KB context for API ─── */
  const getKnowledgeContext = useCallback(() => {
    return kbEntries
      .filter((e) => e.id && selectedKbIds.has(e.id))
      .map((e) => ({
        title: e.title,
        content: e.content,
        type: getEntryType(e.type).label,
      }));
  }, [kbEntries, selectedKbIds]);

  const toggleKbEntry = (entryId: string) => {
    setSelectedKbIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  /* ─── Auth guard ─── */
  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [user, authLoading, router]);

  /* ─── Real-time lead listener ─── */
  useEffect(() => {
    if (!id || !user) return;
    const unsub = onSnapshot(doc(db, "leads", id as string), (snap) => {
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() };
        setLead(data);
        if (loading) {
          setNotes(snap.data().notes || "");
          if (snap.data().contactMethods) setContactMethods(snap.data().contactMethods);
        }
      }
      setLoading(false);
    });
    return () => unsub();
  }, [id, user, loading]);

  /* ─── Real-time chat listener ─── */
  useEffect(() => {
    if (!id || !user) return;
    const q = query(
      collection(db, "leads", id as string, "chatMessages"),
      orderBy("createdAt", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const msgs: ChatMessage[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ChatMessage, "id">),
      }));
      setChatMessages(msgs);
    });
    return () => unsub();
  }, [id, user]);

  /* ─── Auto-scroll chat ─── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isSending]);

  /* ─── Save notes ─── */
  const saveNotes = useCallback(async () => {
    if (!lead) return;
    setNotesSaving(true);
    try {
      await updateDoc(doc(db, "leads", lead.id), { notes });
      setNotesSaved(true);
    } catch (err) {
      console.error("Failed to save notes:", err);
    } finally {
      setNotesSaving(false);
    }
  }, [lead, notes]);

  /* ─── Pipeline & actions ─── */
  const updateStatus = async (s: string) => {
    if (lead) await updateDoc(doc(db, "leads", lead.id), { status: s });
  };
  const archiveLead = async () => {
    if (lead) await updateDoc(doc(db, "leads", lead.id), { status: "archived" });
  };

  /* ─── Contact lookup ─── */
  const lookupContacts = async () => {
    if (!lead) return;
    setContactLoading(true);
    try {
      const res = await fetch("/api/contact-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: lead.link, title: lead.title, companyInfo: lead.companyInfo }),
      });
      if (!res.ok) throw new Error("Lookup failed");
      const data = await res.json();
      setContactMethods(data.contactMethods);
      // Persist to Firestore
      await updateDoc(doc(db, "leads", lead.id), { contactMethods: data.contactMethods });
    } catch (err) {
      console.error("Contact lookup error:", err);
    } finally {
      setContactLoading(false);
    }
  };

  /* ─── Compose email helper ─── */
  const getLatestProposal = (): string => {
    const assistantMsgs = chatMessages.filter((m) => m.role === "assistant");
    return assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1].content : "";
  };

  const composeEmail = (email?: string) => {
    const body = getLatestProposal();
    const subject = `Regarding: ${lead?.title || "Opportunity"}`;
    const mailto = `mailto:${email || ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, "_blank");
  };

  const deleteLead = async () => {
    if (!lead) return;
    await deleteDoc(doc(db, "leads", lead.id));
    router.push("/");
  };

  /* ─── Send chat message ─── */
  const sendMessage = async (text?: string) => {
    const msg = (text || chatInput).trim();
    if (!msg || !lead || isSending) return;
    setChatInput("");
    setChatError("");
    setIsSending(true);

    // Persist user message
    const userMsg: ChatMessage = { role: "user", content: msg, createdAt: Timestamp.now() };
    await addDoc(collection(db, "leads", lead.id, "chatMessages"), userMsg);

    // Build history for API (exclude the message we just sent — it'll be userMessage)
    const historyForApi = chatMessages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/proposal-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead,
          companyProfile: "",
          history: historyForApi,
          userMessage: msg,
          knowledgeContext: getKnowledgeContext(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to get response");
      }
      const data = await res.json();

      // Persist assistant response
      await addDoc(collection(db, "leads", lead.id, "chatMessages"), {
        role: "assistant",
        content: data.message,
        createdAt: Timestamp.now(),
      });

      // Auto-advance pipeline on first proposal
      if (chatMessages.length === 0 && ["new", "reviewing", "shortlisted"].includes(lead.status)) {
        await updateDoc(doc(db, "leads", lead.id), { status: "proposal_sent" });
      }
    } catch (err: any) {
      setChatError(err.message || "Something went wrong.");
    } finally {
      setIsSending(false);
    }
  };

  const copyText = (text: string, msgId: string) => {
    navigator.clipboard.writeText(text);
    setCopied(msgId);
    setTimeout(() => setCopied(null), 2000);
  };

  const clearChat = async () => {
    if (!lead) return;
    // Delete all messages in subcollection
    for (const msg of chatMessages) {
      if (msg.id) await deleteDoc(doc(db, "leads", lead.id, "chatMessages", msg.id));
    }
  };

  /* ─── Loading / Error states ─── */
  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin text-blue-600" size={48} />
      </div>
    );
  }
  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <h1 className="text-2xl font-bold mb-4">Lead not found</h1>
        <Link href="/" className="text-blue-600 hover:underline">Back to Dashboard</Link>
      </div>
    );
  }

  const currentStage = getStage(lead.status);

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* ─── Header ─── */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link href="/" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 truncate">{lead.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/knowledge" className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 transition-colors">
              <BookOpen size={13} /> Knowledge Base
            </Link>
            {lead.status !== "archived" && (
              <button onClick={archiveLead} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-amber-600 bg-gray-50 hover:bg-amber-50 rounded-lg border border-gray-200 transition-colors">
                <Archive size={13} /> Archive
              </button>
            )}
            {confirmDelete ? (
              <button onClick={deleteLead} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 rounded-lg border border-red-200 hover:bg-red-100 transition-colors">
                <Trash2 size={13} /> Confirm Delete
              </button>
            ) : (
              <button onClick={() => { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 4000); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-red-600 bg-gray-50 hover:bg-red-50 rounded-lg border border-gray-200 transition-colors">
                <Trash2 size={13} /> Delete
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ═══ Left Sidebar ═══ */}
        <div className="lg:col-span-1 space-y-5">
          {/* Pipeline */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Pipeline Stage</h2>
            <div className="space-y-1">
              {PIPELINE_STAGES.map((s) => {
                const isCurrent = s.key === lead.status;
                return (
                  <button key={s.key} onClick={() => updateStatus(s.key)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${isCurrent ? `${s.color} border font-bold ring-1 ring-offset-1 ring-gray-200` : "text-gray-500 hover:bg-gray-50"}`}>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isCurrent ? s.dot : "bg-gray-300"}`} />
                    {s.label}
                    {isCurrent && <ChevronRight size={12} className="ml-auto" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Lead details */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Lead Details</h2>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Source</label>
                <p className="text-sm text-gray-900 flex items-center gap-1.5 mt-0.5">
                  {lead.source === "job_board" ? <><Laptop size={13} className="text-violet-500" /> Job Board</> : <><Globe size={13} className="text-emerald-500" /> Web Search</>}
                </p>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Company</label>
                <p className="text-sm text-gray-900 font-medium flex items-center gap-1.5 mt-0.5"><User size={13} className="text-gray-400" />{renderMetaValue(lead.companyInfo)}</p>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Type</label>
                <p className="text-sm text-gray-900 flex items-center gap-1.5 mt-0.5"><Briefcase size={13} className="text-gray-400" />{renderMetaValue(lead.projectType)}</p>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Priority</label>
                <div className="flex items-center gap-0.5 mt-1">
                  {[1,2,3,4,5].map((s) => (
                    <Star key={s} size={16} className={`${s <= (lead.priority||0) ? lead.priority >= 4 ? "text-amber-500" : "text-yellow-400" : "text-gray-200"} fill-current`} />
                  ))}
                  {lead.priority && <span className="ml-1.5 text-xs text-gray-500">{lead.priority}/5</span>}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Key Skills</label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {lead.keySkills?.map((s: string) => (
                    <span key={s} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-[10px] font-medium">{s}</span>
                  ))}
                  {!lead.keySkills?.length && <span className="text-xs text-gray-400 italic">None extracted</span>}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Original Link</label>
                <a href={lead.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-blue-600 hover:underline truncate mt-0.5">
                  <ExternalLink size={12} />{lead.link}
                </a>
              </div>
            </div>
          </div>

          {/* Contact & Outreach */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Mail size={13} className="text-indigo-500" /> Contact & Outreach
              </h2>
              <button onClick={lookupContacts} disabled={contactLoading}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 transition-colors disabled:opacity-50">
                {contactLoading ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />}
                {contactLoading ? "Looking up…" : contactMethods ? "Re-scan" : "Find contacts"}
              </button>
            </div>

            {contactMethods ? (
              <div className="space-y-2">
                {contactMethods.email && (
                  <a href={`mailto:${contactMethods.email}`}
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition-colors group">
                    <Mail size={14} className="flex-shrink-0" />
                    <span className="truncate">{contactMethods.email}</span>
                    <ExternalLink size={10} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                  </a>
                )}
                {contactMethods.linkedIn && (
                  <a href={contactMethods.linkedIn} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-lg transition-colors group">
                    <Linkedin size={14} className="flex-shrink-0" />
                    <span className="truncate">LinkedIn Profile</span>
                    <ExternalLink size={10} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                  </a>
                )}
                {contactMethods.webForm && (
                  <a href={contactMethods.webForm} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-colors group">
                    <Globe2 size={14} className="flex-shrink-0" />
                    <span className="truncate">Contact Form</span>
                    <ExternalLink size={10} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                  </a>
                )}
                {contactMethods.phone && (
                  <a href={`tel:${contactMethods.phone}`}
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg transition-colors group">
                    <Phone size={14} className="flex-shrink-0" />
                    <span>{contactMethods.phone}</span>
                  </a>
                )}
                {contactMethods.notes && (
                  <p className="text-[11px] text-gray-400 mt-2 leading-relaxed italic">{contactMethods.notes}</p>
                )}

                {/* Compose email with latest proposal */}
                {getLatestProposal() && contactMethods.email && (
                  <button onClick={() => composeEmail(contactMethods.email)}
                    className="w-full flex items-center justify-center gap-1.5 mt-3 px-3 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-sm">
                    <FileText size={13} /> Send proposal via email
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-4">
                Click &ldquo;Find contacts&rdquo; to have Gemini infer contact details from this lead.
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><StickyNote size={13} className="text-amber-500" />Notes</h2>
              <button onClick={saveNotes} disabled={notesSaving || notesSaved}
                className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-md transition-colors ${notesSaved ? "text-emerald-600 bg-emerald-50 border border-emerald-200" : "text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100"}`}>
                {notesSaving ? <Loader2 size={10} className="animate-spin" /> : notesSaved ? <><Check size={10} /> Saved</> : <><Save size={10} /> Save</>}
              </button>
            </div>
            <textarea className="w-full p-3 text-sm border border-gray-200 rounded-lg h-36 outline-none focus:ring-2 focus:ring-blue-500 resize-none leading-relaxed placeholder:text-gray-400"
              value={notes} onChange={(e) => { setNotes(e.target.value); setNotesSaved(false); }}
              placeholder={"Add your notes about this lead…\n\ne.g., Key decision-maker: John Smith\nBudget range: $50k-$100k"} />
          </div>

          {/* Knowledge Base Context */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <button
              onClick={() => setKbExpanded(!kbExpanded)}
              className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center">
                  <Database size={14} className="text-white" />
                </div>
                <div className="text-left">
                  <h2 className="text-xs font-bold text-gray-700 uppercase tracking-wider">AI Context</h2>
                  <p className="text-[10px] text-gray-400">{selectedKbIds.size} of {kbEntries.length} entries selected</p>
                </div>
              </div>
              <ChevronDown size={16} className={`text-gray-400 transition-transform ${kbExpanded ? "rotate-180" : ""}`} />
            </button>

            {kbExpanded && (
              <div className="border-t border-gray-100 px-4 pb-4">
                {kbLoading ? (
                  <div className="py-4 flex justify-center">
                    <Loader2 size={16} className="animate-spin text-indigo-500" />
                  </div>
                ) : kbEntries.length === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-xs text-gray-400 mb-2">No entries yet.</p>
                    <Link href="/knowledge" className="text-xs text-indigo-600 font-medium hover:underline">
                      Add to Knowledge Base →
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-1.5 mt-3">
                    {kbEntries.map((entry) => {
                      const isSelected = entry.id ? selectedKbIds.has(entry.id) : false;
                      const entryType = getEntryType(entry.type);
                      return (
                        <label
                          key={entry.id}
                          className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all border ${
                            isSelected
                              ? "bg-indigo-50 border-indigo-200"
                              : "bg-white border-gray-100 hover:bg-gray-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => entry.id && toggleKbEntry(entry.id)}
                            className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase rounded border ${entryType.color}`}>
                                {entryType.label}
                              </span>
                            </div>
                            <p className="text-xs font-medium text-gray-800 mt-1 truncate">{entry.title}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">
                              {entry.content?.slice(0, 80) || "File only"}
                              {(entry.content?.length || 0) > 80 ? "…" : ""}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                    <Link href="/knowledge" className="block text-center text-[11px] text-indigo-600 font-medium hover:underline mt-2 pt-2 border-t border-gray-100">
                      Manage Knowledge Base →
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ═══ Right Column — Chat Interface ═══ */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col" style={{ height: "calc(100vh - 120px)" }}>
            {/* Chat header */}
            <div className="p-4 border-b flex justify-between items-center bg-gradient-to-r from-blue-50 to-indigo-50 rounded-t-xl">
              <div className="flex items-center gap-2 text-gray-700 font-semibold text-sm">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <Sparkles size={16} className="text-white" />
                </div>
                <div>
                  <span className="block">Proposal Chat</span>
                  <span className="text-[10px] text-gray-400 font-normal">
                    Powered by Gemini
                    {selectedKbIds.size > 0 && (
                      <span className="ml-1.5 text-indigo-500 font-medium">• {selectedKbIds.size} context {selectedKbIds.size === 1 ? "entry" : "entries"}</span>
                    )}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {getLatestProposal() && (
                  <button onClick={() => composeEmail(contactMethods?.email)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                    <Mail size={12} /> Compose email
                  </button>
                )}
                {chatMessages.length > 0 && (
                  <button onClick={clearChat} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-red-600 bg-white border border-gray-200 rounded-lg hover:bg-red-50 transition-colors">
                    <RotateCcw size={12} /> Clear chat
                  </button>
                )}
              </div>
            </div>

            {/* Chat messages area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.length === 0 && !isSending ? (
                /* Empty state with quick actions */
                <div className="h-full flex flex-col items-center justify-center text-center px-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-2xl flex items-center justify-center mb-5 shadow-lg shadow-blue-200">
                    <MessageSquare size={28} />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1">Start a conversation</h3>
                  <p className="text-sm text-gray-500 max-w-md mb-6">
                    Chat with Gemini to draft proposals, emails, or messages. You can iterate and refine until it&apos;s perfect.
                  </p>
                  <div className="grid grid-cols-2 gap-2 max-w-md w-full">
                    {QUICK_PROMPTS.map((qp) => (
                      <button key={qp.label} onClick={() => sendMessage(qp.prompt)}
                        className="px-4 py-3 text-sm font-medium text-left bg-gray-50 hover:bg-blue-50 hover:text-blue-700 border border-gray-200 hover:border-blue-300 rounded-xl transition-all group">
                        <Sparkles size={14} className="inline mr-1.5 text-gray-400 group-hover:text-blue-500 transition-colors" />
                        {qp.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* Messages */
                <>
                  {chatMessages.map((msg, i) => (
                    <div key={msg.id || i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      {msg.role === "assistant" && (
                        <div className="flex-shrink-0 w-7 h-7 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center mt-1">
                          <Bot size={14} className="text-white" />
                        </div>
                      )}
                      <div className={`max-w-[80%] relative group ${msg.role === "user" ? "bg-blue-600 text-white rounded-2xl rounded-br-md px-4 py-3" : "bg-gray-50 text-gray-800 rounded-2xl rounded-bl-md px-4 py-3 border border-gray-100"}`}>
                        <div className={`text-sm leading-relaxed whitespace-pre-wrap ${msg.role === "assistant" ? "prose prose-sm max-w-none" : ""}`}>
                          {msg.content}
                        </div>
                        {msg.role === "assistant" && (
                          <button onClick={() => copyText(msg.content, msg.id || String(i))}
                            className="absolute -bottom-3 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-white border border-gray-200 rounded-md shadow-sm hover:bg-gray-50">
                            {copied === (msg.id || String(i)) ? <><Check size={10} className="text-green-600" /> Copied</> : <><Copy size={10} /> Copy</>}
                          </button>
                        )}
                      </div>
                      {msg.role === "user" && (
                        <div className="flex-shrink-0 w-7 h-7 bg-gray-200 rounded-lg flex items-center justify-center mt-1">
                          <UserCircle size={14} className="text-gray-500" />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Typing indicator */}
                  {isSending && (
                    <div className="flex gap-3 justify-start">
                      <div className="flex-shrink-0 w-7 h-7 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center mt-1">
                        <Bot size={14} className="text-white" />
                      </div>
                      <div className="bg-gray-50 border border-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </>
              )}
            </div>

            {/* Error banner */}
            {chatError && (
              <div className="mx-4 mb-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center justify-between">
                {chatError}
                <button onClick={() => setChatError("")} className="text-red-400 hover:text-red-600 ml-2 font-bold">✕</button>
              </div>
            )}

            {/* Input bar */}
            <div className="p-4 border-t bg-white rounded-b-xl">
              <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
                <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                  placeholder={chatMessages.length ? "Ask Gemini to refine, shorten, or change the tone…" : "Ask Gemini to draft a proposal…"}
                  className="flex-1 px-4 py-3 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-400"
                  disabled={isSending} />
                <button type="submit" disabled={isSending || !chatInput.trim()}
                  className="px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 font-medium text-sm">
                  {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
