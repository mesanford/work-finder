"use client";

import { useState, useEffect } from "react";
import { X, Plus, Trash2 } from "lucide-react";

interface SearchProfile {
  id?: string;
  name: string;
  keywords: string[];
  companyTypes: string[];
  companySizes: string[];
  projectTypes: string[];
  sources: string[];
}

const COMPANY_TYPE_OPTIONS = [
  "Startup", "SMB", "Enterprise", "Government", "Non-Profit", "Agency"
];

const COMPANY_SIZE_OPTIONS = [
  "1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"
];

const PROJECT_TYPE_OPTIONS = [
  "Contract", "Part-Time", "Freelance", "RFP", "Full-Time Remote", "Consulting"
];

const SOURCE_OPTIONS = [
  { value: "google_search", label: "Google Search" },
  { value: "job_boards", label: "Job Boards (Indeed/LinkedIn)" },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (profile: Omit<SearchProfile, "id">) => Promise<void>;
  editProfile?: SearchProfile | null;
}

export default function SearchProfileModal({ isOpen, onClose, onSave, editProfile }: Props) {
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [companyTypes, setCompanyTypes] = useState<string[]>([]);
  const [companySizes, setCompanySizes] = useState<string[]>([]);
  const [projectTypes, setProjectTypes] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>(["google_search"]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editProfile) {
      setName(editProfile.name);
      setKeywords(editProfile.keywords || []);
      setCompanyTypes(editProfile.companyTypes || []);
      setCompanySizes(editProfile.companySizes || []);
      setProjectTypes(editProfile.projectTypes || []);
      setSources(editProfile.sources || ["google_search"]);
    } else {
      setName("");
      setKeywords([]);
      setCompanyTypes([]);
      setCompanySizes([]);
      setProjectTypes([]);
      setSources(["google_search"]);
    }
  }, [editProfile, isOpen]);

  const addKeyword = () => {
    const trimmed = keywordInput.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      setKeywords([...keywords, trimmed]);
      setKeywordInput("");
    }
  };

  const removeKeyword = (kw: string) => {
    setKeywords(keywords.filter((k) => k !== kw));
  };

  const toggleMulti = (
    value: string,
    list: string[],
    setList: (v: string[]) => void
  ) => {
    if (list.includes(value)) {
      setList(list.filter((v) => v !== value));
    } else {
      setList([...list, value]);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        keywords,
        companyTypes,
        companySizes,
        projectTypes,
        sources,
      });
      onClose();
    } catch (err) {
      console.error("Save error:", err);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">
            {editProfile ? "Edit Search Profile" : "New Search Profile"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Profile Name</label>
            <input
              type="text"
              placeholder="e.g. React Contracts, Gov RFPs..."
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Keywords */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Keywords</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add a keyword..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeyword())}
              />
              <button
                onClick={addKeyword}
                type="button"
                className="px-3 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <Plus size={18} className="text-gray-600" />
              </button>
            </div>
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {keywords.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium"
                  >
                    {kw}
                    <button onClick={() => removeKeyword(kw)} className="hover:text-blue-900">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Project Types */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Project Types</label>
            <div className="flex flex-wrap gap-2">
              {PROJECT_TYPE_OPTIONS.map((pt) => (
                <button
                  key={pt}
                  type="button"
                  onClick={() => toggleMulti(pt, projectTypes, setProjectTypes)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    projectTypes.includes(pt)
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-blue-300"
                  }`}
                >
                  {pt}
                </button>
              ))}
            </div>
          </div>

          {/* Company Types */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Company Types</label>
            <div className="flex flex-wrap gap-2">
              {COMPANY_TYPE_OPTIONS.map((ct) => (
                <button
                  key={ct}
                  type="button"
                  onClick={() => toggleMulti(ct, companyTypes, setCompanyTypes)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    companyTypes.includes(ct)
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-emerald-300"
                  }`}
                >
                  {ct}
                </button>
              ))}
            </div>
          </div>

          {/* Company Sizes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Company Sizes</label>
            <div className="flex flex-wrap gap-2">
              {COMPANY_SIZE_OPTIONS.map((cs) => (
                <button
                  key={cs}
                  type="button"
                  onClick={() => toggleMulti(cs, companySizes, setCompanySizes)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    companySizes.includes(cs)
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-violet-300"
                  }`}
                >
                  {cs} employees
                </button>
              ))}
            </div>
          </div>

          {/* Sources */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Search Sources</label>
            <div className="space-y-2">
              {SOURCE_OPTIONS.map((src) => (
                <label key={src.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sources.includes(src.value)}
                    onChange={() => toggleMulti(src.value, sources, setSources)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{src.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-6 py-2 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
          >
            {saving ? "Saving..." : editProfile ? "Update Profile" : "Create Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}
