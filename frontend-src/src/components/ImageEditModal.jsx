import { useState, useEffect, useRef } from "react";
import { editImage, SEEDREAM_T2I_SIZES } from "../api.js";
import { getOutputDir, saveDataUrlToDisk, makeTimestamp } from "../utils/outputDir.js";

// ── Node.js helpers ──────────────────────────────────────────────────────────

function getNodeRequire() {
  if (typeof window !== "undefined" && typeof window.require === "function") return window.require;
  if (typeof require === "function") return require;
  return null;
}

/**
 * Save a data URL to the media folder and return the absolute path.
 * Returns null if Node.js is unavailable.
 */
async function saveResult(dataUrl) {
  const dir = await getOutputDir("image");
  return saveDataUrlToDisk(dataUrl, dir, `seedream_edit_${makeTimestamp()}.png`);
}

/**
 * Open a file path in Photoshop.
 * Tries known Photoshop install locations, falls back to system default.
 * Returns a status string for UI feedback.
 */
function openInPhotoshop(filePath) {
  const r = getNodeRequire();
  if (!r) return "Node.js not available in this context.";

  const { exec } = r("child_process");
  const fs       = r("fs");
  const os       = r("os");

  if (os.platform() === "win32") {
    // Try common Photoshop installation paths (newest first)
    const psCandidates = [
      "C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe",
      "C:\\Program Files\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe",
      "C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe",
      "C:\\Program Files\\Adobe\\Adobe Photoshop 2023\\Photoshop.exe",
      "C:\\Program Files\\Adobe\\Adobe Photoshop 2022\\Photoshop.exe",
    ];
    const psExe = psCandidates.find((p) => fs.existsSync(p));
    if (psExe) {
      exec(`"${psExe}" "${filePath}"`);
      return "opened_ps";
    }
    // Fallback: open with system default
    exec(`start "" "${filePath}"`);
    return "opened_default";
  } else {
    // macOS
    exec(`open -a "Adobe Photoshop" "${filePath}"`, (err) => {
      if (err) exec(`open "${filePath}"`);
    });
    return "opened_ps";
  }
}

// ── Zoom lightbox ────────────────────────────────────────────────────────────

function ZoomView({ src, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.95)" }}
      onClick={onClose}
    >
      <img
        src={src}
        alt="Full size preview"
        style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain" }}
        className="rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800/80 text-zinc-300 hover:text-white hover:bg-zinc-700 transition"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <div className="absolute bottom-3 text-[10px] text-zinc-600">Click anywhere or Esc to close</div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ImageEditModal({ imageDataUrl, onConfirm, onClose }) {
  const [prompt,      setPrompt]      = useState("");
  const [result,      setResult]      = useState(null);
  const [savedPath,   setSavedPath]   = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [zoomed,      setZoomed]      = useState(null); // null | "original" | "result"
  const [psStatus,    setPsStatus]    = useState(null); // null | "opened_ps" | "opened_default" | error string
  const [sizeMode,    setSizeMode]    = useState("match"); // "match" | explicit size id
  const [inputDims,   setInputDims]   = useState(null);
  const textareaRef = useRef(null);

  // Read input dimensions once so we can show "match input (WxH)" in the UI
  useEffect(() => {
    if (!imageDataUrl) return;
    const img = new Image();
    img.onload = () => setInputDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = imageDataUrl;
  }, [imageDataUrl]);

  useEffect(() => { setTimeout(() => textareaRef.current?.focus(), 50); }, []);

  // Escape: close zoom first, then modal
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== "Escape") return;
      if (zoomed) { setZoomed(null); return; }
      onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [zoomed, onClose]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSavedPath(null);
    setPsStatus(null);
    try {
      const opts = sizeMode === "match"
        ? { matchInput: true }
        : { matchInput: false, size: sizeMode };
      const edited = await editImage(imageDataUrl, prompt, opts);
      setResult(edited);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGenerate(); }
  };

  const handleUse = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const path = savedPath || await saveResult(result);
      if (path) setSavedPath(path);
    } catch (_) {}
    setSaving(false);
    onConfirm(result);
  };

  const handleOpenInPhotoshop = async () => {
    if (!result) return;
    setSaving(true);
    setPsStatus(null);
    try {
      // Save first if not already saved
      const path = savedPath || await saveResult(result);
      if (path) {
        setSavedPath(path);
        const status = openInPhotoshop(path);
        setPsStatus(status);
      } else {
        setPsStatus("Could not save file — Node.js unavailable.");
      }
    } catch (e) {
      setPsStatus("Error: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-3"
        style={{ background: "rgba(0,0,0,0.88)" }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm flex flex-col gap-3 p-4 shadow-2xl">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-brand-600 flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white leading-tight">Edit Image</h3>
                <p className="text-[10px] text-zinc-500 leading-tight">Seedream 5.0 · i2i</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-500 hover:text-white hover:bg-zinc-700 transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Image comparison */}
          <div className="grid grid-cols-2 gap-2">
            {/* Original */}
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Original</span>
              <div
                className="relative group cursor-zoom-in"
                onClick={() => setZoomed("original")}
              >
                <img
                  src={imageDataUrl}
                  alt="Original"
                  className="w-full h-32 object-cover rounded-xl border border-zinc-700 transition group-hover:brightness-75"
                />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition pointer-events-none">
                  <svg className="w-6 h-6 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0zm-6-3v6m-3-3h6" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Result */}
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Result</span>
              {result ? (
                <div
                  className="relative group cursor-zoom-in"
                  onClick={() => setZoomed("result")}
                >
                  <img
                    src={result}
                    alt="Edited"
                    className="w-full h-32 object-cover rounded-xl border border-brand-500 transition group-hover:brightness-75"
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition pointer-events-none">
                    <svg className="w-6 h-6 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0zm-6-3v6m-3-3h6" />
                    </svg>
                  </div>
                </div>
              ) : loading ? (
                <div className="w-full h-32 rounded-xl border border-zinc-700 bg-zinc-800/50 flex flex-col items-center justify-center gap-1.5">
                  <div className="w-5 h-5 border-2 border-brand-400 border-t-transparent rounded-full spin-slow" />
                  <span className="text-[10px] text-zinc-500">Generating...</span>
                </div>
              ) : (
                <div className="w-full h-32 rounded-xl border border-dashed border-zinc-700 flex items-center justify-center">
                  <span className="text-[10px] text-zinc-600">Result preview</span>
                </div>
              )}
            </div>
          </div>

          {/* Output size */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Output size</label>
            <select
              value={sizeMode}
              onChange={(e) => setSizeMode(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
            >
              <option value="match">
                Match input{inputDims ? ` (${inputDims.w}×${inputDims.h})` : ""}
              </option>
              {SEEDREAM_T2I_SIZES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <div className="text-[9px] text-zinc-600 leading-snug">
              Default keeps the input's aspect ratio (snapped to a Seedream-supported size). Override only if you want a different aspect.
            </div>
          </div>

          {/* Prompt */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-300">Edit instruction</label>
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder="Describe how to change the image... (Enter to send)"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 pr-9 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500 resize-none"
              />
              <button
                onClick={handleGenerate}
                disabled={loading || !prompt.trim()}
                className="absolute right-2 bottom-2 p-1 rounded text-brand-400 hover:text-brand-300 disabled:text-zinc-600 disabled:cursor-not-allowed transition"
              >
                {loading ? (
                  <div className="w-3.5 h-3.5 border-2 border-brand-400 border-t-transparent rounded-full spin-slow" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="text-[10px] text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* Photoshop status */}
          {psStatus && (
            <div className={`text-[10px] rounded-lg px-3 py-2 ${
              psStatus === "opened_ps" || psStatus === "opened_default"
                ? "text-emerald-400 bg-emerald-400/10"
                : "text-amber-400 bg-amber-400/10"
            }`}>
              {psStatus === "opened_ps"      && "Opened in Photoshop. Save the file, then reload it in the plugin."}
              {psStatus === "opened_default" && "Photoshop not found — opened with system default app."}
              {psStatus !== "opened_ps" && psStatus !== "opened_default" && psStatus}
            </div>
          )}

          {/* Saved path */}
          {savedPath && !psStatus && (
            <div className="text-[10px] text-zinc-500 break-all">Saved: {savedPath}</div>
          )}

          {/* Actions */}
          {result ? (
            <div className="space-y-2">
              {/* Open in Photoshop */}
              <button
                onClick={handleOpenInPhotoshop}
                disabled={saving}
                className="w-full py-2 rounded-xl text-xs font-medium border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800/50 hover:text-white transition disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
                Open in Photoshop
              </button>

              {/* Regenerate + Use */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleGenerate}
                  disabled={loading || !prompt.trim()}
                  className="py-2 rounded-xl text-xs font-medium border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Regenerate
                </button>
                <button
                  onClick={handleUse}
                  disabled={saving}
                  className="py-2 rounded-xl text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-400 transition disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Use this image"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={loading || !prompt.trim()}
              className={`w-full py-2.5 rounded-xl text-xs font-semibold transition ${
                loading || !prompt.trim()
                  ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                  : "bg-brand-600 text-white hover:bg-brand-700 pulse-glow"
              }`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full spin-slow" />
                  Generating edit...
                </span>
              ) : "Generate Edit"}
            </button>
          )}
        </div>
      </div>

      {/* Zoom lightbox — rendered on top of the modal */}
      {zoomed && (
        <ZoomView
          src={zoomed === "original" ? imageDataUrl : result}
          onClose={() => setZoomed(null)}
        />
      )}
    </>
  );
}
