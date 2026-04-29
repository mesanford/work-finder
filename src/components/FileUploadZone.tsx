"use client";

import { useState, useRef, useCallback } from "react";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import {
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE_BYTES,
  formatFileSize,
} from "@/lib/knowledgeBase";
import { Upload, File, X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

interface UploadResult {
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
}

interface FileUploadZoneProps {
  /** Called when upload completes successfully. */
  onUpload: (result: UploadResult) => void;
  /** An existing file already attached to this entry. */
  existingFile?: { fileName: string; fileSizeBytes: number; fileUrl: string } | null;
  /** Clear the existing file. */
  onClearFile?: () => void;
  /** Firestore entryId (used for storage path). Generated if not provided. */
  entryId?: string;
}

export default function FileUploadZone({
  onUpload,
  existingFile,
  onClearFile,
  entryId,
}: FileUploadZoneProps) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState<UploadResult | null>(null);

  const validate = (file: File): string | null => {
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      return `Unsupported file type: ${file.type || "unknown"}. Allowed: PDF, DOCX, TXT, MD, PNG, JPEG, WebP, GIF.`;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `File too large (${formatFileSize(file.size)}). Max: ${formatFileSize(MAX_FILE_SIZE_BYTES)}.`;
    }
    return null;
  };

  const handleUpload = useCallback(
    async (file: File) => {
      if (!user) return;
      setError("");
      const validationError = validate(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      setUploading(true);
      setProgress(0);

      const id = entryId || crypto.randomUUID();
      const storagePath = `users/${user.uid}/knowledge/${id}/${file.name}`;
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        "state_changed",
        (snap) => {
          setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
        },
        (err) => {
          console.error("Upload error:", err);
          setError("Upload failed. Please try again.");
          setUploading(false);
        },
        async () => {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          const result: UploadResult = {
            fileUrl: url,
            fileName: file.name,
            fileType: file.type,
            fileSizeBytes: file.size,
          };
          setUploaded(result);
          setUploading(false);
          onUpload(result);
        }
      );
    },
    [user, entryId, onUpload]
  );

  /* ─── Drag events ─── */
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };
  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  };

  /* ─── Already uploaded state ─── */
  if (uploaded || existingFile) {
    const f = uploaded || existingFile!;
    return (
      <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
        <div className="w-9 h-9 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <CheckCircle2 size={18} className="text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-emerald-800 truncate">
            {(f as any).fileName}
          </p>
          <p className="text-[11px] text-emerald-600">
            {formatFileSize((f as any).fileSizeBytes)}
          </p>
        </div>
        {onClearFile && (
          <button
            onClick={() => {
              setUploaded(null);
              onClearFile();
            }}
            className="p-1 text-emerald-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            title="Remove file"
          >
            <X size={16} />
          </button>
        )}
      </div>
    );
  }

  /* ─── Uploading state ─── */
  if (uploading) {
    return (
      <div className="p-4 border-2 border-blue-200 bg-blue-50 rounded-xl">
        <div className="flex items-center gap-3 mb-2">
          <Loader2 size={18} className="text-blue-600 animate-spin" />
          <span className="text-sm font-medium text-blue-700">Uploading… {progress}%</span>
        </div>
        <div className="w-full h-2 bg-blue-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    );
  }

  /* ─── Drop zone ─── */
  return (
    <div>
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
          dragActive
            ? "border-blue-400 bg-blue-50 scale-[1.01]"
            : "border-gray-200 bg-gray-50 hover:border-blue-300 hover:bg-blue-50/50"
        }`}
      >
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
          dragActive ? "bg-blue-100" : "bg-gray-100"
        }`}>
          <Upload size={20} className={dragActive ? "text-blue-600" : "text-gray-400"} />
        </div>
        <p className="text-sm font-medium text-gray-600">
          {dragActive ? "Drop your file here" : "Drag & drop or click to browse"}
        </p>
        <p className="text-[11px] text-gray-400">
          PDF, DOCX, TXT, MD, or images · Max 10 MB
        </p>
        <input
          ref={inputRef}
          type="file"
          onChange={onFileSelect}
          accept={ALLOWED_FILE_TYPES.join(",")}
          className="hidden"
        />
      </div>
      {error && (
        <div className="flex items-center gap-2 mt-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <AlertTriangle size={14} className="flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
