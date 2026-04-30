"use client";

import { useState, useRef, useEffect } from "react";
import {
  Star, ExternalLink, Briefcase, User, ChevronRight,
  Globe, Laptop, StickyNote, Archive, Trash2, ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { doc, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PIPELINE_STAGES, getStage } from "@/lib/pipeline";

interface Lead {
  id: string;
  title: string;
  snippet: string;
  link: string;
  status: string;
  description?: string;
  projectType?: string;
  keySkills?: string[];
  companyInfo?: string;
  priority?: number;
  source?: string;
  notes?: string;
  createdAt: any;
}

interface LeadCardProps {
  lead: Lead;
}

export default function LeadCard({ lead }: LeadCardProps) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setStatusOpen(false);
      }
    }
    if (statusOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [statusOpen]);

  const stage = getStage(lead.status);

  const updateStatus = async (newStatus: string) => {
    setStatusOpen(false);
    try {
      await updateDoc(doc(db, "leads", lead.id), { status: newStatus });
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const archiveLead = async () => {
    try {
      await updateDoc(doc(db, "leads", lead.id), { status: "archived" });
    } catch (err) {
      console.error("Failed to archive:", err);
    }
  };

  const deleteLead = async () => {
    try {
      await deleteDoc(doc(db, "leads", lead.id));
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  const priorityColor = (p?: number) => {
    if (!p) return "text-gray-300";
    if (p >= 4) return "text-amber-500";
    if (p >= 2) return "text-yellow-400";
    return "text-gray-300";
  };

  const renderMetaValue = (val: any) => {
    if (!val) return "Unknown";
    if (typeof val === "string") return val;
    if (typeof val === "object") {
      return val.name || val.type || val.label || JSON.stringify(val);
    }
    return String(val);
  };

  const sourceIcon = lead.source === "job_board"
    ? <Laptop size={12} className="text-violet-500" />
    : <Globe size={12} className="text-emerald-500" />;

  const sourceLabel = lead.source === "job_board" ? "Job Board" : "Web Search";

  return (
    <div className={`p-4 bg-white rounded-xl shadow-sm border hover:shadow-md transition-all flex flex-col h-full ${
      lead.status === "archived" ? "border-gray-200 opacity-60" : "border-gray-200 hover:border-gray-300"
    }`}>
      {/* Header: title + stars */}
      <div className="flex justify-between items-start mb-1.5 gap-2">
        <h3 className="text-sm font-bold text-gray-900 line-clamp-2 leading-snug flex-1">
          {lead.title}
        </h3>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {[1, 2, 3, 4, 5].map((s) => (
            <Star
              key={s}
              size={13}
              className={`${s <= (lead.priority || 0) ? priorityColor(lead.priority) : "text-gray-200"} fill-current`}
            />
          ))}
        </div>
      </div>

      {/* Status badge dropdown */}
      <div className="relative mb-2" ref={dropdownRef}>
        <button
          onClick={() => setStatusOpen(!statusOpen)}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border cursor-pointer transition-colors ${stage.color}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${stage.dot}`} />
          {stage.label}
          <ChevronDown size={10} className={`transition-transform ${statusOpen ? "rotate-180" : ""}`} />
        </button>

        {statusOpen && (
          <div className="absolute left-0 top-full mt-1 w-44 bg-white rounded-lg border border-gray-200 shadow-lg z-20 py-1">
            {PIPELINE_STAGES.map((s) => (
              <button
                key={s.key}
                onClick={() => updateStatus(s.key)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 transition-colors ${
                  s.key === lead.status ? "font-bold" : "font-medium text-gray-600"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                {s.label}
                {s.key === lead.status && <span className="ml-auto text-blue-600">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Snippet */}
      <p className="text-xs text-gray-500 mb-2.5 line-clamp-2 leading-relaxed">
        {lead.description || lead.snippet}
      </p>

      {/* Skills */}
      <div className="flex flex-wrap gap-1 mb-3">
        {lead.keySkills?.slice(0, 4).map((skill) => (
          <span key={skill} className="px-2 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-700 rounded-full">
            {skill}
          </span>
        ))}
        {(lead.keySkills?.length || 0) > 4 && (
          <span className="px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 rounded-full">
            +{(lead.keySkills?.length || 0) - 4}
          </span>
        )}
      </div>

      {/* Meta footer */}
      <div className="mt-auto pt-3 border-t border-gray-100">
        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-2.5">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Briefcase size={12} />
              {renderMetaValue(lead.projectType)}
            </span>
            <span className="flex items-center gap-1">
              <User size={12} />
              <span className="truncate max-w-[90px]">{renderMetaValue(lead.companyInfo)}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {lead.notes && (
              <span className="flex items-center gap-0.5 text-amber-500" title="Has notes">
                <StickyNote size={11} />
              </span>
            )}
            <span className="flex items-center gap-1">
              {sourceIcon}
              {sourceLabel}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-1.5">
          <a
            href={lead.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ExternalLink size={12} />
            Source
          </a>

          {lead.status !== "archived" ? (
            <button
              onClick={archiveLead}
              className="flex items-center justify-center px-2 py-1.5 text-xs text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
              title="Archive lead"
            >
              <Archive size={13} />
            </button>
          ) : confirmDelete ? (
            <button
              onClick={deleteLead}
              className="flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-semibold text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
            >
              <Trash2 size={12} />
              Confirm
            </button>
          ) : (
            <button
              onClick={() => { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }}
              className="flex items-center justify-center px-2 py-1.5 text-xs text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Delete lead"
            >
              <Trash2 size={13} />
            </button>
          )}

          <Link
            href={`/lead/${lead.id}`}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            View & Propose <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
