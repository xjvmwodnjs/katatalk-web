// =============================================================
// UploadHero: SGF file upload area with drag-and-drop + Auth Guard
// =============================================================

import { useState, useRef, useCallback } from "react";
import { Upload, FileText, ShieldAlert } from "lucide-react";
import { Translations } from "@/lib/mockData";

interface UploadHeroProps {
  t: Translations;
  onAnalyze: (file: File) => void;
  isAuthenticated: boolean;
  onLoginRequired: () => void;
}

export default function UploadHero({ t, onAnalyze, isAuthenticated, onLoginRequired }: UploadHeroProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auth Guard: intercept all upload interactions
  const guardAuth = (): boolean => {
    if (!isAuthenticated) {
      onLoginRequired();
      return false;
    }
    return true;
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!isAuthenticated) {
      onLoginRequired();
      return;
    }
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.toLowerCase().endsWith(".sgf")) {
      setFile(droppedFile);
    }
  }, [isAuthenticated, onLoginRequired]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  };

  const handleUploadClick = () => {
    if (!guardAuth()) return;
    inputRef.current?.click();
  };

  const handleAnalyze = () => {
    if (!guardAuth()) return;
    if (!file) return;
    onAnalyze(file);
  };

  return (
    <section className="py-12 md:py-20">
      {/* Hero text */}
      <div className="text-center mb-10">
        <h1
          className="text-3xl md:text-4xl lg:text-5xl font-bold text-amber-100 mb-4"
          style={{ fontFamily: "'Noto Serif KR', serif", lineHeight: 1.3 }}
        >
          {t.heroTitle}
        </h1>
        <p
          className="text-base md:text-lg text-slate-400 max-w-2xl mx-auto"
          style={{ fontFamily: "'Noto Sans KR', sans-serif", lineHeight: 1.7 }}
        >
          {t.heroSubtitle}
        </p>
      </div>

      {/* Upload area */}
      <div className="max-w-lg mx-auto">
        <div
          className={`relative rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer ${
            isDragging
              ? "border-amber-400 bg-amber-400/5 scale-[1.02]"
              : file
              ? "border-green-500/50 bg-green-500/5"
              : !isAuthenticated
              ? "border-slate-700/50 opacity-90"
              : "border-slate-700 hover:border-amber-500/50 hover:bg-amber-500/3"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => { if (!file && !isAuthenticated) onLoginRequired(); }}
          style={{ backdropFilter: "blur(4px)" }}
        >
          {/* Auth Guard overlay for unauthenticated users */}
          {!isAuthenticated && !file && (
            <div className="absolute inset-0 rounded-2xl flex items-center justify-center z-10 bg-black/20">
              <div className="flex flex-col items-center gap-2 px-4 text-center">
                <ShieldAlert className="w-8 h-8 text-amber-400/70" />
                <p className="text-xs text-amber-300/80 font-medium" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                  {t.loginRequired}
                </p>
              </div>
            </div>
          )}

          <div className="px-8 py-12 flex flex-col items-center text-center">
            {file ? (
              <>
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: "rgba(74, 222, 128, 0.15)", border: "1px solid rgba(74, 222, 128, 0.3)" }}
                >
                  <FileText className="w-7 h-7 text-green-400" />
                </div>
                <p className="text-green-300 font-medium mb-1" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                  {file.name}
                </p>
                <p className="text-xs text-slate-500 mb-5">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
                <button
                  onClick={handleAnalyze}
                  className="px-8 py-3 rounded-xl font-semibold text-sm transition-all duration-200 hover:scale-105 active:scale-95"
                  style={{
                    background: "linear-gradient(135deg, #C9A84C, #A08030)",
                    color: "#000",
                    boxShadow: "0 4px 20px rgba(201, 168, 76, 0.3)",
                    fontFamily: "'Noto Sans KR', sans-serif",
                  }}
                >
                  {t.uploadTitle}
                </button>
              </>
            ) : (
              <>
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
                  style={{
                    background: "rgba(201, 168, 76, 0.1)",
                    border: "1px solid rgba(201, 168, 76, 0.2)",
                  }}
                >
                  <Upload className="w-8 h-8 text-amber-400" />
                </div>
                <h3
                  className="text-lg font-semibold text-amber-100 mb-2"
                  style={{ fontFamily: "'Noto Serif KR', serif" }}
                >
                  {t.uploadTitle}
                </h3>
                <p className="text-sm text-slate-400 mb-5" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                  {t.uploadDescription}
                </p>
                <button
                  onClick={handleUploadClick}
                  className="px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200 hover:scale-105 active:scale-95 mb-3"
                  style={{
                    background: "linear-gradient(135deg, #C9A84C, #A08030)",
                    color: "#000",
                    boxShadow: "0 4px 20px rgba(201, 168, 76, 0.3)",
                    fontFamily: "'Noto Sans KR', sans-serif",
                  }}
                >
                  {t.uploadButton}
                </button>
                <p className="text-xs text-slate-600" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                  {t.uploadDragDrop}
                </p>
                <p className="text-[10px] text-slate-700 mt-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                  {t.uploadFormats}
                </p>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".sgf,.SGF"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      </div>
    </section>
  );
}
