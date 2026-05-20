import { useState, useRef } from "react";
import { saveVideoLocally, uploadVideoToTempHost } from "../api.js";
import { getOutputDir } from "../utils/outputDir.js";

const isAutoHost = () => {
  const v = localStorage.getItem("seedance_auto_host");
  return v === null ? true : v === "1";
};

function getNodeRequire() {
  if (typeof window !== "undefined" && typeof window.require === "function") return window.require;
  return null;
}

function guessVideoMime(p) {
  const ext = p.toLowerCase().split(".").pop();
  return {
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    mkv: "video/x-matroska", avi: "video/x-msvideo", m4v: "video/x-m4v",
  }[ext] || "video/mp4";
}

/**
 * Open a folder in the OS file manager.
 */
function revealInFileManager(folderPath) {
  const nreq = getNodeRequire();
  if (!nreq) return false;
  try {
    const { exec } = nreq("child_process");
    const os = nreq("os");
    const cmd =
      os.platform() === "win32" ? `explorer "${folderPath}"` :
      os.platform() === "darwin" ? `open "${folderPath}"` :
      `xdg-open "${folderPath}"`;
    exec(cmd);
    return true;
  } catch (_) {
    return false;
  }
}

export default function VideoUploader({ label, hint, value, onChange }) {
  // Default to "file" so the drop zone is visible immediately — users
  // expected drag&drop on Reference Videos and were missing it because the
  // default tab was URL.
  const [mode,      setMode]      = useState("file");
  const [urlInput,  setUrlInput]  = useState(value || "");
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState(null);
  const [savedPath, setSavedPath] = useState(null);
  const [aeInfo,    setAeInfo]    = useState(null);
  const [dragOver,  setDragOver]  = useState(false);
  const fileRef = useRef();

  const inAE = typeof window !== "undefined" && window.AEBridge?.isInAfterEffects?.();

  // --- Handle a local File: auto-upload OR save locally (based on settings) ---
  const handleLocalFile = async (file) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    setSavedPath(null);
    try {
      if (isAutoHost()) {
        // Auto-upload to tmpfiles.org → public URL that BytePlus can fetch
        const url = await uploadVideoToTempHost(file);
        onChange(url);
        setUrlInput(url);
      } else {
        // Privacy mode: save locally, user hosts manually
        const dir = await getOutputDir("video");
        if (!dir) throw new Error("Output folder not set. Configure it in Settings.");
        const outPath = await saveVideoLocally(file, dir);
        setSavedPath(outPath);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // --- Render AE work area → auto-upload OR show local path -----------------
  const useAEWorkArea = async () => {
    setError(null);
    setSavedPath(null);
    setAeInfo({ info: "Rendering work area from the active comp…" });
    try {
      const info = await window.AEBridge.renderWorkAreaToFile(15);
      if (info?.error) throw new Error(info.error);
      if (!info?.path) throw new Error("No rendered file path from AE.");
      setAeInfo({
        info: `${info.compName} · work area ${info.duration.toFixed(1)}s · ${info.template}`,
      });

      if (isAutoHost()) {
        // Read the rendered file via Node.js and upload to tmpfiles.org
        setBusy(true);
        const nreq = getNodeRequire();
        if (!nreq) throw new Error("Node.js not available.");
        const fs   = nreq("fs");
        const path = nreq("path");
        const buf  = fs.readFileSync(info.path);
        const file = new File([buf], path.basename(info.path), { type: guessVideoMime(info.path) });
        const url = await uploadVideoToTempHost(file);
        onChange(url);
        setUrlInput(url);
        // Clean up temp render file
        try { fs.unlinkSync(info.path); } catch (_) {}
      } else {
        // Privacy mode: just show the path
        setSavedPath(info.path);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      // If we're in URL mode and the user drops a file, auto-switch to file
      // mode so they see the upload progress.
      if (mode !== "file") setMode("file");
      handleLocalFile(file);
    }
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);

  const handleUrlConfirm = () => {
    if (urlInput.trim()) {
      onChange(urlInput.trim());
      setSavedPath(null);
      setError(null);
      setAeInfo(null);
    }
  };

  const clearUrl = () => {
    setUrlInput("");
    onChange("");
    setSavedPath(null);
    setError(null);
    setAeInfo(null);
  };

  const copyPath = async () => {
    if (!savedPath) return;
    try { await navigator.clipboard.writeText(savedPath); } catch (_) {}
  };

  const openFolder = () => {
    if (!savedPath) return;
    const nreq = getNodeRequire();
    if (!nreq) return;
    const folder = nreq("path").dirname(savedPath);
    revealInFileManager(folder);
  };

  const hasValue = !!(value || "").trim();

  return (
    <div
      className="space-y-1"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Label + mode toggle */}
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-medium text-zinc-400">
          {label}
          {hint && <span className="text-zinc-600 font-normal ml-1">{hint}</span>}
        </label>
        <div className="flex gap-1 text-[10px]">
          {inAE && (
            <button
              onClick={useAEWorkArea}
              disabled={busy}
              className="px-2 py-0.5 rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 transition disabled:opacity-50"
              title="Render the comp's work area (max 15s)"
            >↗ From AE work area</button>
          )}
          <button
            onClick={() => setMode("file")}
            className={`px-2 py-0.5 rounded transition ${mode === "file" ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
          >File</button>
          <button
            onClick={() => setMode("url")}
            className={`px-2 py-0.5 rounded transition ${mode === "url" ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
          >URL</button>
        </div>
      </div>

      {/* Mode: File */}
      {mode === "file" && (
        <>
          <div
            onClick={() => !busy && fileRef.current?.click()}
            className={`h-16 border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition cursor-pointer ${
              busy
                ? "border-brand-500 bg-brand-500/5 cursor-wait"
                : dragOver
                  ? "border-brand-400 bg-brand-500/10"
                  : "border-zinc-700 hover:border-brand-500 hover:bg-zinc-800/30"
            }`}
          >
            {busy ? (
              <>
                <div className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full spin-slow mb-1" />
                <span className="text-[10px] text-zinc-400">{isAutoHost() ? "Uploading to tmpfiles.org…" : "Saving locally…"}</span>
              </>
            ) : (
              <>
                <span className="text-[10px] text-zinc-500">Drop video or click to browse</span>
                <span className="text-[9px] text-zinc-600 mt-0.5">
                  {isAutoHost()
                    ? "MP4 · auto-uploaded to tmpfiles.org (~60 min)"
                    : "MP4 · saved locally — you host it yourself"}
                </span>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/*"
              className="hidden"
              onChange={(e) => handleLocalFile(e.target.files?.[0])}
            />
          </div>
        </>
      )}

      {/* Mode: URL */}
      {mode === "url" && (
        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://… or asset://<ID>"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500"
          />
          <button
            onClick={handleUrlConfirm}
            className="px-3 py-1.5 bg-brand-600 text-white text-xs rounded-lg hover:bg-brand-700 transition"
          >Set</button>
          {hasValue && (
            <button onClick={clearUrl} className="px-2 py-1.5 text-zinc-500 hover:text-red-400 transition text-xs">✕</button>
          )}
        </div>
      )}

      {/* Errors */}
      {error && (
        <div className="text-[10px] text-red-400 bg-red-400/10 rounded p-1.5 break-all">
          {error}
        </div>
      )}

      {/* AE work-area status */}
      {aeInfo?.info && (
        <div className="text-[10px] text-blue-400 bg-blue-400/10 rounded p-1.5">↗ {aeInfo.info}</div>
      )}

      {/* File saved locally — prompt user to host + paste URL */}
      {savedPath && !hasValue && (
        <div className="text-[10px] bg-amber-500/5 border border-amber-500/30 rounded-lg p-2 space-y-1.5">
          <div className="text-amber-300 font-medium">✓ Saved locally — now paste the public URL above</div>
          <div className="text-zinc-400 break-all font-mono text-[9px]">{savedPath}</div>
          <div className="flex gap-1 pt-0.5">
            <button onClick={copyPath}   className="px-2 py-0.5 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 text-[10px]">Copy path</button>
            <button onClick={openFolder} className="px-2 py-0.5 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 text-[10px]">Open folder</button>
            <button onClick={() => setMode("url")} className="px-2 py-0.5 rounded bg-brand-600 text-white hover:bg-brand-700 text-[10px]">Paste URL →</button>
          </div>
          <div className="text-zinc-500 text-[9px] leading-snug pt-0.5 border-t border-zinc-800">
            BytePlus requires a public HTTPS URL. Recommended: upload to your own
            {" "}
            <span className="text-zinc-300">BytePlus TOS bucket</span> (public-read) or any CDN/S3.
            {" "}Real-person videos must be registered first via BytePlus console → paste the returned
            {" "}<span className="text-zinc-300 font-mono">asset://&lt;id&gt;</span>.
          </div>
        </div>
      )}

      {/* Current value preview — with × to clear regardless of mode */}
      {hasValue && !error && (
        <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-2 py-1">
          <svg className="w-3 h-3 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-[10px] text-emerald-300 truncate flex-1">
            {value.startsWith("asset://") ? value : (value.length > 60 ? value.slice(0, 60) + "…" : value)}
          </span>
          <button
            onClick={clearUrl}
            className="text-zinc-400 hover:text-red-400 text-xs flex-shrink-0 leading-none"
            title="Remove this reference video"
          >✕</button>
        </div>
      )}
    </div>
  );
}
