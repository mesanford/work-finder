"use client";

import { useState, useEffect } from "react";
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import SearchProfileModal from "./SearchProfileModal";
import { Plus, Pencil, Trash2, Bookmark, Play, ChevronDown, ChevronUp, Briefcase } from "lucide-react";

interface SearchProfile {
  id: string;
  name: string;
  keywords: string[];
  companyTypes: string[];
  companySizes: string[];
  projectTypes: string[];
  sources: string[];
  maxResults?: number;
}

interface Props {
  onRunSearch: (profile: SearchProfile) => void;
  isSearching: boolean;
}

export default function SearchProfileSidebar({ onRunSearch, isSearching }: Props) {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<SearchProfile[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<SearchProfile | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "searchProfiles"),
      where("userId", "==", user.uid)
    );
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SearchProfile));
      setProfiles(data);
    });
    return () => unsub();
  }, [user]);

  const handleSave = async (profile: Omit<SearchProfile, "id">) => {
    if (!user) return;
    if (editProfile) {
      await updateDoc(doc(db, "searchProfiles", editProfile.id), {
        ...profile,
        updatedAt: serverTimestamp(),
      });
    } else {
      await addDoc(collection(db, "searchProfiles"), {
        ...profile,
        userId: user.uid,
        createdAt: serverTimestamp(),
      });
    }
    setEditProfile(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this search profile?")) return;
    await deleteDoc(doc(db, "searchProfiles", id));
  };

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark size={18} className="text-blue-600" />
            <h3 className="text-sm font-bold text-gray-800">Search Profiles</h3>
          </div>
          <button
            onClick={() => { setEditProfile(null); setModalOpen(true); }}
            className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
          >
            <Plus size={16} />
          </button>
        </div>

        {profiles.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-xs text-gray-400 mb-2">No profiles yet</p>
            <button
              onClick={() => { setEditProfile(null); setModalOpen(true); }}
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              Create your first profile
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {profiles.map((profile) => (
              <div key={profile.id} className="group">
                <div className="p-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <button
                    className="flex-1 text-left flex items-center gap-2"
                    onClick={() => setExpandedId(expandedId === profile.id ? null : profile.id)}
                  >
                    <Briefcase size={14} className="text-gray-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-gray-700 truncate">{profile.name}</span>
                    {expandedId === profile.id ? (
                      <ChevronUp size={14} className="text-gray-400 ml-auto flex-shrink-0" />
                    ) : (
                      <ChevronDown size={14} className="text-gray-400 ml-auto flex-shrink-0" />
                    )}
                  </button>
                  <div className="flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onRunSearch(profile)}
                      disabled={isSearching}
                      className="p-1 rounded hover:bg-blue-50 text-blue-600 disabled:opacity-40"
                      title="Run search"
                    >
                      <Play size={14} />
                    </button>
                    <button
                      onClick={() => { setEditProfile(profile); setModalOpen(true); }}
                      className="p-1 rounded hover:bg-gray-100 text-gray-500"
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(profile.id)}
                      className="p-1 rounded hover:bg-red-50 text-red-400"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {expandedId === profile.id && (
                  <div className="px-3 pb-3 space-y-1.5">
                    {profile.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {profile.keywords.map((kw) => (
                          <span key={kw} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium">
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                    {profile.projectTypes.length > 0 && (
                      <p className="text-[10px] text-gray-500">
                        <span className="font-medium">Types:</span> {profile.projectTypes.join(", ")}
                      </p>
                    )}
                    {profile.companyTypes.length > 0 && (
                      <p className="text-[10px] text-gray-500">
                        <span className="font-medium">Companies:</span> {profile.companyTypes.join(", ")}
                      </p>
                    )}
                    <p className="text-[10px] text-gray-500">
                      <span className="font-medium">Max results:</span> {profile.maxResults ?? 25}
                    </p>
                    <button
                      onClick={() => onRunSearch(profile)}
                      disabled={isSearching}
                      className="w-full mt-1 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
                    >
                      {isSearching ? "Searching..." : "Run This Search"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <SearchProfileModal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditProfile(null); }}
        onSave={handleSave}
        editProfile={editProfile}
      />
    </>
  );
}
