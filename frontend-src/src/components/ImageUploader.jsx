import { useState, useRef, useEffect } from "react";
import ImageEditModal from "./ImageEditModal.jsx";
import { getOutputDir, makeTimestamp } from "../utils/outputDir.js";

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function getNodeRequire() {
  if (typeof window !== "undefined" && typeof window.require === "function") return window.require;
  if (typeof require === "function") return require;
  return null;
}

export default function ImageUploader({ label, onUploaded, onUrlSet, uploadId, imageUrl }) {
  // Derived initial preview from props so the image is visible immediately
  // on mount (history restore, programmatic set from Image tab, etc.).
  const [preview,    setPreview]    = useState(uploadId || imageUrl || null);
  const [mode,       setMode]       = useState("file"); // "file" | "url"
  const [urlInput,   setUrlInput]   = useState(imageUrl || "");
  const [converting, setConverting] = useState(false);
  const [editOpen,   setEditOpen]   = useState(false);
  const [snapBusy,   setSnapBusy]   = useState(false);
  const [snapError,  setSnapError]  = useState(null);
  const fileRef = useRef();

  // Keep the local preview in sync when the parent updates the props.
  // (Fixes: history restore, use-as-reference from Image tab, and the case
  // where the AE snapshot was set but the component later re-rendered with
  // new props.)
  useEffect(() => {
    const next = uploadId || imageUrl || null;
    setPreview((prev) => (next === prev ? prev : next));
    if (imageUrl !== undefined && imageUrl !== urlInput) setUrlInput(imageUrl || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId, imageUrl]);

  const inAE = typeof window !== "undefined" && window.AEBridge?.isInAfterEffects?.();

  /**
   * Snapshot the current AE comp frame, save to the project's snapshot folder,
   * read it back as a data URL, and stuff it into this uploader.
   */
  const captureFromAE = async () => {
    if (!inAE) return;
    setSnapError(null);
    setSnapBusy(true);
    try {
      const dir = await getOutputDir("snapshot");
      if (!dir) throw new Error("Could not determine snapshot folder.");
      const _req = getNodeRequire();
      if (!_req) throw new Error("Node.js (require) unavailable in CEP context.");
      const path = _req("path");
      const fs   = _req("fs");
      const target = path.join(dir, `frame_${makeTimestamp()}.png`);
      const res = await window.AEBridge.captureCurrentFrameToFile(target);
      if (res?.error) throw new Error(res.error);
      if (!res?.path) throw new Error("AE returned no snapshot path.");
      if (!fs.existsSync(res.path)) {
        throw new Error(`AE reported success but the file is missing at ${res.path}`);
      }
      const buf = fs.readFileSync(res.path);
      if (buf.length < 100) {
        throw new Error(`Captured file is empty or truncated (${buf.length} bytes at ${res.path}).`);
      }
      // PNG magic: 89 50 4E 47 0D 0A 1A 0A. JPG magic: FF D8 FF.
      const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
      const isJpg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
      if (!isPng && !isJpg) {
        throw new Error(`Captured file is not a valid PNG/JPEG. First bytes: ${[...buf.slice(0,4)].map(b=>b.toString(16)).join(" ")}`);
      }
      const mime = isPng ? "image/png" : "image/jpeg";
      const b64 = buf.toString("base64");
      const dataUrl = `data:${mime};base64,${b64}`;
      setPreview(dataUrl);
      onUploaded(dataUrl);
      onUrlSet("");
    } catch (e) {
      setSnapError(e.message);
    } finally {
      setSnapBusy(false);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    setConverting(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      setPreview(dataUrl);
      onUploaded(dataUrl);
      onUrlSet("");
    } catch (e) {
      console.error("Image read failed:", e);
    } finally {
      setConverting(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  };

  const handleUrlConfirm = () => {
    if (urlInput.trim()) {
      onUrlSet(urlInput.trim());
      onUploaded(null);
      setPreview(urlInput.trim());
    }
  };

  const clear = () => {
    setPreview(null);
    setUrlInput("");
    onUploaded(null);
    onUrlSet("");
    if (fileRef.current) fileRef.current.value = "";
  };

  // Called when the user clicks "Use this image" in the edit modal
  const handleEditConfirm = (editedDataUrl) => {
    setPreview(editedDataUrl);
    onUploaded(editedDataUrl);
    onUrlSet("");
    setEditOpen(false);
  };

  // The current image source (for passing to the edit modal)
  const currentImage = preview || null;

  return (
    <>
      <div className="space-y-1.5">
        {/* Label + mode toggle + AE snapshot */}
        <div className="flex items-center justify-between gap-1 flex-wrap">
          <label className="text-xs font-medium text-zinc-300">{label}</label>
          <div className="flex gap-1 text-[10px] items-center">
            {inAE && (
              <button
                onClick={captureFromAE}
                disabled={snapBusy}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 border border-blue-500/30 transition disabled:opacity-50"
                title="Capture the current AE comp frame at the playhead and use it here"
              >
                {snapBusy ? (
                  <>
                    <span className="w-2.5 h-2.5 border-[1.5px] border-blue-300 border-t-transparent rounded-full spin-slow" />
                    Capturing…
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Insert AE frame
                  </>
                )}
              </button>
            )}
            <button
              onClick={() => setMode("file")}
              className={`px-2 py-0.5 rounded transition ${mode === "file" ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              File
            </button>
            <button
              onClick={() => setMode("url")}
              className={`px-2 py-0.5 rounded transition ${mode === "url" ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              URL
            </button>
          </div>
        </div>
        {snapError && (
          <div className="text-[10px] text-red-400 bg-red-400/10 rounded p-1 break-all">
            Snapshot error: {snapError}
          </div>
        )}

        {/* Preview */}
        {preview ? (
          <div className="relative group">
            <img
              src={preview}
              alt="Preview"
              className="w-full h-28 object-cover rounded-xl border border-zinc-700"
            />

            {/* Edit (pencil) button — always visible on hover */}
            {currentImage && (
              <button
                onClick={() => setEditOpen(true)}
                className="absolute top-1.5 left-1.5 w-7 h-7 flex items-center justify-center rounded-lg bg-black/70 text-zinc-300 hover:text-white hover:bg-brand-600 transition opacity-0 group-hover:opacity-100"
                title="Edit image with AI"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}

            {/* Remove button */}
            <button
              onClick={clear}
              className="absolute top-1.5 right-1.5 w-7 h-7 flex items-center justify-center rounded-lg bg-black/70 text-zinc-300 hover:text-white hover:bg-red-600 transition opacity-0 group-hover:opacity-100"
              title="Remove image"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Converting overlay */}
            {converting && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-xl">
                <div className="w-5 h-5 border-2 border-brand-400 border-t-transparent rounded-full spin-slow" />
              </div>
            )}

            {/* Edit hint */}
            <div className="absolute bottom-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition">
              <span className="text-[9px] bg-black/70 text-zinc-400 px-1.5 py-0.5 rounded">
                ✏ hover to edit
              </span>
            </div>
          </div>
        ) : mode === "file" ? (
          <div
            onClick={() => fileRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="h-24 border-2 border-dashed border-zinc-700 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-brand-500 hover:bg-zinc-800/30 transition"
          >
            <svg className="w-5 h-5 text-zinc-500 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-[10px] text-zinc-500">Drop image or click to browse</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
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
              placeholder="https://example.com/image.png"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500"
            />
            <button
              onClick={handleUrlConfirm}
              className="px-3 py-1.5 bg-brand-600 text-white text-xs rounded-lg hover:bg-brand-700 transition"
            >
              Set
            </button>
          </div>
        )}
      </div>

      {/* Image Edit Modal — rendered in a portal-like fashion outside the card */}
      {editOpen && currentImage && (
        <ImageEditModal
          imageDataUrl={currentImage}
          onConfirm={handleEditConfirm}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  );
}
