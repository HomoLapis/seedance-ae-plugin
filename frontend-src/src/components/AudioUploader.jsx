import { useState, useRef } from "react";
import { uploadAudioFile } from "../api.js";
import { wavBytesToMp3File } from "../utils/wavToMp3.js";

function getNodeRequire() {
  if (typeof window !== "undefined" && typeof window.require === "function") return window.require;
  if (typeof require === "function") return require;
  return null;
}
export default function AudioUploader({ label, hint, value, onChange }) {
  const [mode,       setMode]       = useState("file");
  const [urlInput,   setUrlInput]   = useState(value || "");
  const [fileName,   setFileName]   = useState(null);
  const [uploading,  setUploading]  = useState(false);
  const [uploadErr,  setUploadErr]  = useState(null);
  const [aeInfo,     setAeInfo]     = useState(null);
  const fileRef = useRef();

  const inAE = typeof window !== "undefined" && window.AEBridge?.isInAfterEffects?.();

  const useAEWorkArea = async () => {
    setUploadErr(null);
    setAeInfo({ info: "Rendering work-area audio from active comp…" });
    try {
      const info = await window.AEBridge.renderWorkAreaAudioToFile(15);
      if (info?.error) throw new Error(info.error);
      if (!info?.path) throw new Error("No audio path returned from AE.");
      setAeInfo({
        info: `${info.compName} · ${info.duration.toFixed(1)}s · ${info.template} (.${info.extension})`,
        warn: info.warn || null,
      });

      const nreq = getNodeRequire();
      if (!nreq) throw new Error("Node.js not available.");
      const fs = nreq("fs"), path = nreq("path");
      const rawBytes = fs.readFileSync(info.path);
      const ext = (info.extension || path.extname(info.path).slice(1) || "").toLowerCase();

      // BytePlus Seedance r2v rejects AE's native WAV-PCM and AIFF formats:
      //   "the parameter audio format specified in the request is not valid for
      //    model dreamina-seedance-2-0 in r2v"
      // It accepts MP3. Adobe removed MP3 export from AE's render queue years
      // ago, so we transcode WAV/AIFF → MP3 here in the panel using lamejs +
      // the Web Audio API decoder. Chromium's decodeAudioData handles WAV
      // (PCM/float) reliably; AIFF support is spotty, so prefer WAV upstream.
      let fileToUpload;
      if (ext === "wav" || ext === "aif" || ext === "aiff") {
        setAeInfo((s) => ({ ...(s || {}), info: `${s?.info || ""} → encoding MP3…` }));
        try {
          const ab = rawBytes.buffer.slice(
            rawBytes.byteOffset,
            rawBytes.byteOffset + rawBytes.byteLength
          );
          fileToUpload = await wavBytesToMp3File(ab, path.basename(info.path), 128);
        } catch (decErr) {
          throw new Error(`Couldn't transcode .${ext} to MP3: ${decErr.message}`);
        }
      } else if (ext === "mp3") {
        fileToUpload = new File([rawBytes], path.basename(info.path), { type: "audio/mpeg" });
      } else {
        // AE produced a video container (e.g. .mov) because no audio template
        // was available — BytePlus will reject this. Surface a clear error.
        throw new Error(
          `AE rendered '${path.basename(info.path)}' (.${ext}) which BytePlus does not accept. ` +
          `Enable a 'WAV' output template in After Effects (Edit → Templates → Output Module).`
        );
      }

      await handleFile(fileToUpload);
      // Clean up the temp render
      try { fs.unlinkSync(info.path); } catch (_) {}
    } catch (e) {
      setAeInfo(null);
      setUploadErr(e.message);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    setUploadErr(null);
    setUploading(true);
    setFileName(file.name);
    try {
      const url = await uploadAudioFile(file);
      onChange(url);
      setUrlInput(url);
    } catch (e) {
      setUploadErr(e.message);
      setFileName(null);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  };

  const handleUrlConfirm = () => {
    if (urlInput.trim()) {
      onChange(urlInput.trim());
      setFileName(null);
      setUploadErr(null);
    }
  };

  const clear = () => {
    setUrlInput("");
    setFileName(null);
    setUploadErr(null);
    onChange("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const hasValue = !!(value || "").trim();

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-medium text-zinc-400">
          {label}
          {hint && <span className="text-zinc-600 font-normal ml-1">{hint}</span>}
        </label>
        <div className="flex gap-1 text-[10px]">
          {inAE && (
            <button
              onClick={useAEWorkArea}
              disabled={uploading}
              className="px-2 py-0.5 rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 transition disabled:opacity-50"
              title="Render the comp's work-area audio (max 15s)"
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

      {mode === "file" ? (
        <div
          onClick={() => !uploading && fileRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className={`h-14 border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition cursor-pointer ${
            uploading
              ? "border-brand-500 bg-brand-500/5 cursor-wait"
              : "border-zinc-700 hover:border-brand-500 hover:bg-zinc-800/30"
          }`}
        >
          {uploading ? (
            <>
              <div className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full spin-slow mb-1" />
              <span className="text-[10px] text-zinc-400">Uploading {fileName}…</span>
            </>
          ) : hasValue && fileName ? (
            <div className="flex items-center gap-2 px-2">
              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-[10px] text-emerald-400 truncate">{fileName}</span>
              <button
                onClick={(e) => { e.stopPropagation(); clear(); }}
                className="ml-auto text-zinc-500 hover:text-red-400"
              >✕</button>
            </div>
          ) : (
            <>
              <span className="text-[10px] text-zinc-500">Drop audio or click to browse</span>
              <span className="text-[9px] text-zinc-600 mt-0.5">MP3 · WAV · ≤15s · encoded inline (base64)</span>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://… (public URL, MP3/WAV)"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500"
          />
          <button
            onClick={handleUrlConfirm}
            className="px-3 py-1.5 bg-brand-600 text-white text-xs rounded-lg hover:bg-brand-700 transition"
          >Set</button>
          {hasValue && (
            <button
              onClick={clear}
              className="px-2 py-1.5 text-zinc-500 hover:text-red-400 text-xs"
            >✕</button>
          )}
        </div>
      )}

      {uploadErr && (
        <div className="text-[10px] text-red-400 bg-red-400/10 rounded p-1.5 break-all">
          Upload error: {uploadErr}
        </div>
      )}
      {aeInfo?.warn && <div className="text-[10px] text-amber-400 bg-amber-400/10 rounded p-1.5">⚠ {aeInfo.warn}</div>}
      {aeInfo?.info && <div className="text-[10px] text-blue-400 bg-blue-400/10 rounded p-1.5">↗ AE layer: {aeInfo.info}</div>}

      {hasValue && !uploading && !uploadErr && (
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-2 py-1">
          <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-[10px] text-emerald-300 truncate flex-1">
            {fileName || (value.startsWith("data:") ? "Audio (base64)" :
                         value.startsWith("http") ? (value.length > 50 ? value.slice(0, 50) + "…" : value) :
                         value)}
          </span>
          <button
            onClick={clear}
            className="text-zinc-400 hover:text-red-400 text-xs flex-shrink-0"
            title="Remove audio"
          >✕</button>
        </div>
      )}
    </div>
  );
}
