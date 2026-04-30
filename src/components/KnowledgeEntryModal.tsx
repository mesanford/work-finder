"use client";

import { useState, useEffect } from "react";
import {
  KB_ENTRY_TYPES,
  type KBEntryType,
  type KnowledgeEntry,
  parseTags,
} from "@/lib/knowledgeBase";
import FileUploadZone from "@/components/FileUploadZone";
import {
  X, Save, Trash2, Tag, Loader2,
  Building2, FileText, UserCircle, Briefcase, Shield, BookOpen,
  Link, Sparkles,
} from "lucide-react";

/* Map icon keys to components */
const ICON_MAP: Record<string, React.ElementType> = {
  Building2, FileText, UserCircle, Briefcase, Shield, BookOpen,
};

interface KnowledgeEntryModalProps {
  entry: Partial<KnowledgeEntry> | null; // null = new entry
  onSave: (data: Partial<KnowledgeEntry>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export default function KnowledgeEntryModal({
  entry,
  onSave,
  onDelete,
  onClose,
}: KnowledgeEntryModalProps) {
  const isEdit = !!entry?.id;

  const [title, setTitle] = useState(entry?.title || "");
  const [type, setType] = useState<KBEntryType>(entry?.type || "company_info");
  const [content, setContent] = useState(entry?.content || "");
  const [tagsRaw, setTagsRaw] = useState((entry?.tags || []).join(", "));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /* URL import */
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  /* File state */
  const [fileUrl, setFileUrl] = useState(entry?.fileUrl || "");
  const [fileName, setFileName] = useState(entry?.fileName || "");
  const [fileType, setFileType] = useState(entry?.fileType || "");
  const [fileSizeBytes, setFileSizeBytes] = useState(entry?.fileSizeBytes || 0);

  /* Close on Escape */
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportError("");
    try {
      const res = await fetch("/api/kb-from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      const { entry } = data;
      if (entry.title) setTitle(entry.title);
      if (entry.content) setContent(entry.content);
      if (entry.type) setType(entry.type);
      if (entry.tags?.length) setTagsRaw(entry.tags.join(", "));
      setImportUrl("");
    } catch (err: any) {
      setImportError(err.message || "Failed to import from URL");
    } finally {
      setImporting(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        type,
        content,
        tags: parseTags(tagsRaw),
        source: fileUrl ? "upload" : "manual",
        ...(fileUrl && { fileUrl, fileName, fileType, fileSizeBytes }),
      });
      onClose();
    } catch (err) {
      console.error("Save error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      onClose();
    } catch (err) {
      console.error("Delete error:", err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95">
        {/* ─── Header ─── */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-indigo-50 to-violet-50 rounded-t-2xl">
          <h2 className="text-lg font-bold text-gray-900">
            {isEdit ? "Edit Entry" : "New Knowledge Base Entry"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* ─── Body ─── */}
        <div className="p-6 space-y-5">
          {/* URL Import */}
          {!isEdit && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
              <label className="block text-xs font-bold text-indigo-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Sparkles size={12} /> Import from URL
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="url"
                    value={importUrl}
                    onChange={(e) => { setImportUrl(e.target.value); setImportError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleImportUrl(); } }}
                    placeholder="https://company.com/about, linkedin.com/in/…"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-indigo-200 bg-white rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400"
                    disabled={importing}
                  />
                </div>
                <button
                  onClick={handleImportUrl}
                  disabled={importing || !importUrl.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {importing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {importing ? "Importing…" : "Import"}
                </button>
              </div>
              {importError && (
                <p className="text-xs text-red-600 mt-2">{importError}</p>
              )}
              {!importError && (
                <p className="text-[11px] text-indigo-500 mt-2">
                  Gemini will fetch the page and pre-fill the fields below. You can edit before saving.
                </p>
              )}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., About Our Company, Standard Proposal Template…"
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-gray-400"
              autoFocus
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              Category
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {KB_ENTRY_TYPES.map((t) => {
                const Icon = ICON_MAP[t.icon] || FileText;
                const isActive = type === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setType(t.key)}
                    className={`flex items-center gap-2 px-3 py-2.5 text-xs font-medium rounded-xl border transition-all ${
                      isActive
                        ? `${t.color} border-current ring-1 ring-offset-1 ring-gray-200 font-bold`
                        : "text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <Icon size={14} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              Content
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste or type your content here. This text is sent to Gemini when generating proposals…"
              className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 resize-none leading-relaxed placeholder:text-gray-400"
              rows={8}
            />
            <p className="text-[11px] text-gray-400 mt-1">
              {content.length > 0 ? `${content.length.toLocaleString()} characters` : "AI will use this text when building proposals."}
            </p>
          </div>

          {/* File Upload */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              Attachment (optional)
            </label>
            <FileUploadZone
              onUpload={(result) => {
                setFileUrl(result.fileUrl);
                setFileName(result.fileName);
                setFileType(result.fileType);
                setFileSizeBytes(result.fileSizeBytes);
              }}
              existingFile={fileUrl ? { fileName, fileSizeBytes, fileUrl } : null}
              onClearFile={() => {
                setFileUrl("");
                setFileName("");
                setFileType("");
                setFileSizeBytes(0);
              }}
              entryId={entry?.id}
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Tag size={12} className="text-gray-400" />
              Tags
            </label>
            <input
              type="text"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="Comma-separated, e.g., cloud, aws, saas"
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400"
            />
            {tagsRaw.trim() && (
              <div className="flex flex-wrap gap-1 mt-2">
                {parseTags(tagsRaw).map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-[10px] font-medium"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── Footer ─── */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <div>
            {isEdit && onDelete && (
              confirmDelete ? (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Confirm Delete
                </button>
              ) : (
                <button
                  onClick={() => { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 4000); }}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 border border-gray-200 rounded-lg transition-colors"
                >
                  <Trash2 size={12} /> Delete
                </button>
              )
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="flex items-center gap-1.5 px-5 py-2 text-sm font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 rounded-lg hover:from-indigo-700 hover:to-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {isEdit ? "Update" : "Save Entry"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
