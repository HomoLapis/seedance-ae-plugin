import { useState, useEffect, useRef } from "react";
import { pollTask } from "../api.js";
import { getOutputDir, makeTimestamp } from "../utils/outputDir.js";

// ── Node.js access in CEP ES-module context ────────────────────────────────
function getRequire() {
  if (typeof window !== "undefined" && typeof window.require === "function") return window.require;
  if (typeof require === "function") return require;
  return null;
}

/**
 * Download video to <AE project>/video/ (or settings fallback).
 * Uses Node.js https to bypass browser CORS.
 */
async function downloadVideoNode(videoUrl) {
  const _require = getRequire();
  if (!_require) {
    throw new Error("Node.js (require) not available. Check manifest --enable-nodejs flag.");
  }

  const fs    = _require("fs");
  const https = _require("https");
  const http  = _require("http");

  const outputDir = await getOutputDir("video");

  if (!outputDir) {
    throw new Error("Output folder not set. Configure it in Settings.");
  }

  const filePath   = _require("path").join(outputDir, `seedance_${makeTimestamp()}.mp4`);
  const fileStream = fs.createWriteStream(filePath);

  return new Promise((resolve, reject) => {
    function doGet(url) {
      const mod = url.startsWith("https") ? https : http;
      mod.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (!location) return reject(new Error("Redirect with no Location header"));
          return doGet(location);
        }
        if (res.statusCode !== 200) {
          fileStream.destroy();
          try { fs.unlinkSync(filePath); } catch (_) {}
          return reject(new Error("Download HTTP " + res.statusCode));
        }
        res.pipe(fileStream);
        fileStream.on("finish", () => fileStream.close(() => resolve(filePath)));
        fileStream.on("error", (e) => {
          try { fs.unlinkSync(filePath); } catch (_) {}
          reject(e);
        });
      }).on("error", (e) => {
        try { fs.unlinkSync(filePath); } catch (_) {}
        reject(new Error("Network error: " + e.message));
      });
    }
    doGet(videoUrl);
  });
}

/**
 * Import a local MP4 into After Effects at the playhead.
 * Throws a descriptive Error on any failure.
 */
async function aeImport(localFile, taskId) {
  if (typeof window.AEBridge === "undefined") {
    throw new Error("AEBridge not found — ae-bridge.js may not have loaded.");
  }
  if (!window.AEBridge.isInAfterEffects()) {
    throw new Error("Not inside After Effects (CSInterface unavailable).");
  }
  const result = await window.AEBridge.importAndAddToTimeline(
    localFile,
    "Seedance " + taskId.slice(-6)
  );
  if (!result) {
    throw new Error("importAndAddToTimeline returned null/undefined.");
  }
  if (result.error) {
    throw new Error(result.error);
  }
  return result;
}

// ── constants ──────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  submitted: "Submitted",
  queued:    "In queue",
  running:   "Generating",
  succeeded: "Completed",
  failed:    "Failed",
  cancelled: "Cancelled",
};

const STATUS_COLORS = {
  submitted: "text-blue-400",
  queued:    "text-amber-400",
  running:   "text-brand-400",
  succeeded: "text-emerald-400",
  failed:    "text-red-400",
  cancelled: "text-zinc-400",
};

// ── component ──────────────────────────────────────────────────────────────

export default function TaskStatus({ taskId, onComplete, onOpenAssetHelper, onOpenPreview }) {
  const [task,           setTask]           = useState(null);
  const [localFile,      setLocalFile]      = useState(null);
  const [downloading,    setDownloading]    = useState(false);
  const [aeImporting,    setAeImporting]    = useState(false);
  const [aeImportResult, setAeImportResult] = useState(null);
  const [aeError,        setAeError]        = useState(null);
  const [dlError,        setDlError]        = useState(null);
  const [pollError,      setPollError]      = useState(null);
  const [elapsed,        setElapsed]        = useState(0);
  const [saveAsInfo,     setSaveAsInfo]     = useState(null);

  const timerRef      = useRef(null);
  const pollingRef    = useRef(null);
  const startTime     = useRef(Date.now());
  const postProcessed = useRef(false);

  useEffect(() => {
    if (!taskId) return;

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);

    const poll = async () => {
      try {
        const result = await pollTask(taskId);
        const t      = result.task;
        const status = t?.status || "unknown";
        setTask(t);

        if (!["succeeded", "failed", "cancelled"].includes(status)) return;

        clearInterval(timerRef.current);
        clearInterval(pollingRef.current);

        if (status !== "succeeded" || postProcessed.current) return;
        postProcessed.current = true;
        onComplete?.(result);

        // Locate video URL — BytePlus returns it under content.video_url
        const content  = t?.content || t?.output || {};
        const videoUrl = content.video_url || content.url || null;

        if (!videoUrl) {
          setDlError("No video URL in API response. Raw content: " + JSON.stringify(content));
          return;
        }

        // ── Step 1: download ──────────────────────────────────────────────
        setDownloading(true);
        let filePath = null;
        try {
          filePath = await downloadVideoNode(videoUrl);
          setLocalFile(filePath);
        } catch (e) {
          setDlError(e.message);
        } finally {
          setDownloading(false);
        }

        if (!filePath) return; // download failed, error already shown

        // ── Step 2: AE import ─────────────────────────────────────────────
        setAeImporting(true);
        try {
          const aeResult = await aeImport(filePath, taskId);
          setAeImportResult(aeResult);
        } catch (e) {
          setAeError(e.message);
        } finally {
          setAeImporting(false);
        }

      } catch (e) {
        setPollError(e.message);
      }
    };

    poll();
    pollingRef.current = setInterval(poll, 15000);

    return () => {
      clearInterval(timerRef.current);
      clearInterval(pollingRef.current);
    };
  }, [taskId]);

  const status      = task?.status || "submitted";
  const statusLabel = STATUS_LABELS[status] || status;
  const statusColor = STATUS_COLORS[status] || "text-zinc-400";
  const isRunning   = ["submitted", "queued", "running"].includes(status);

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const videoUrl =
    task?.content?.video_url || task?.content?.url ||
    task?.output?.video_url  || task?.output?.url  || null;

  const lastFrameUrl =
    task?.content?.last_frame_url || task?.content?.last_frame ||
    task?.output?.last_frame_url  || task?.output?.last_frame  || null;

  return (
    <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-3 space-y-2">

      {/* Status row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isRunning && (
            <div className="w-3.5 h-3.5 border-2 border-brand-400 border-t-transparent rounded-full spin-slow" />
          )}
          {status === "succeeded" && (
            <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {status === "failed" && (
            <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
        </div>
        <span className="text-[10px] text-zinc-500 font-mono">{formatTime(elapsed)}</span>
      </div>

      {/* Task ID */}
      <div className="text-[10px] text-zinc-500 font-mono break-all">{taskId}</div>

      {/* Poll error */}
      {pollError && (
        <div className="text-[10px] text-red-400 bg-red-400/10 rounded p-1.5">Poll error: {pollError}</div>
      )}

      {/* BytePlus task error with human-friendly hints */}
      {status === "failed" && task?.error && (() => {
        const raw = task.error.message || task.error.code || JSON.stringify(task.error);
        const low = raw.toLowerCase();
        let hint = null;
        let suggestAsset = false;
        if (low.includes("output audio") && low.includes("sensitive")) {
          hint = 'BytePlus blocked the generated audio. Disable the "Audio" toggle and try again — the video part is still fine.';
        } else if (low.includes("real person")) {
          hint = 'BytePlus blocked a real-human face in the reference. Use a registered asset://<ID>, a Seedance-generated clip, or a depth/pose preprocess of the reference.';
          suggestAsset = true;
        } else if (low.includes("sensitive") || low.includes("policy")) {
          hint = 'Content policy block. Try a different reference, a less specific prompt, or a registered asset://<ID> for protected subjects.';
          suggestAsset = true;
        }
        return (
          <div className="text-[10px] text-red-400 bg-red-400/10 rounded p-1.5 space-y-1">
            <div>{raw}</div>
            {hint && <div className="text-amber-300 italic">💡 {hint}</div>}
            {suggestAsset && onOpenAssetHelper && (
              <button
                onClick={onOpenAssetHelper}
                className="mt-1 px-2 py-1 rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700 text-[10px]"
              >
                Open BytePlus Asset helper →
              </button>
            )}
          </div>
        );
      })()}

      {/* Download status */}
      {downloading && (
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
          <div className="w-3 h-3 border-2 border-zinc-400 border-t-transparent rounded-full spin-slow" />
          Saving video to disk...
        </div>
      )}
      {dlError && (
        <div className="text-[10px] text-red-400 bg-red-400/10 rounded p-1.5">
          Download error: {dlError}
        </div>
      )}
      {localFile && (
        <div className="text-[10px] text-emerald-400 break-all">Saved: {localFile}</div>
      )}

      {/* AE import status */}
      {aeImporting && (
        <div className="flex items-center gap-1.5 text-[10px] text-blue-400">
          <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full spin-slow" />
          Adding to AE timeline...
        </div>
      )}
      {aeError && (
        <div className="text-[10px] text-amber-400 bg-amber-500/10 rounded p-1.5">
          AE import error: {aeError}
        </div>
      )}
      {aeImportResult && !aeError && (
        <div className="text-[10px] text-blue-400 flex items-center gap-1">
          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Added to AE: "{aeImportResult.layerName}" in {aeImportResult.compName}
          {aeImportResult.startTime != null && ` at ${aeImportResult.startTime.toFixed(2)}s`}
        </div>
      )}

      {/* Video preview — compact thumbnail; click to expand in popup */}
      {status === "succeeded" && videoUrl && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onOpenPreview?.({ src: videoUrl, title: `Task ${taskId.slice(0, 12)}…` })}
            className="relative w-24 h-14 rounded-md overflow-hidden border border-zinc-700 hover:border-brand-500 transition bg-black flex-shrink-0 group"
            title="Click to expand"
          >
            <video
              src={videoUrl}
              muted
              playsInline
              preload="none"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/10 transition">
              <svg className="w-5 h-5 text-white drop-shadow" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </button>

          <div className="flex-1 min-w-0 flex flex-col justify-between gap-1">
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => saveVideoAs(videoUrl, taskId, setDlError, setSaveAsInfo)}
                className="text-[10px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200"
                title="Save a copy to a folder you choose"
              >💾 Save as…</button>
              {localFile && (
                <button
                  onClick={() => revealInExplorer(localFile)}
                  className="text-[10px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200"
                  title="Open the containing folder"
                >📁 Show file</button>
              )}
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200"
              >🔗 Open URL</a>
            </div>
            {saveAsInfo && (
              <div className="text-[10px] text-emerald-400 truncate" title={saveAsInfo}>{saveAsInfo}</div>
            )}
          </div>
        </div>
      )}

      {/* Returned last frame (when return_last_frame=true) — compact thumbnail */}
      {status === "succeeded" && lastFrameUrl && (
        <div className="flex gap-2 pt-1 items-start">
          <button
            onClick={() => onOpenPreview?.({ src: lastFrameUrl, title: "Last frame", isImage: true })}
            className="w-16 h-16 rounded-md overflow-hidden border border-zinc-700 hover:border-brand-500 transition flex-shrink-0"
            title="Click to expand"
          >
            <img src={lastFrameUrl} alt="Last frame" className="w-full h-full object-cover" />
          </button>
          <div className="flex-1 min-w-0 space-y-0.5">
            <div className="text-[10px] text-zinc-400">Last frame (for sequential generation)</div>
            <a
              href={lastFrameUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-brand-400 hover:underline break-all block"
            >{lastFrameUrl.length > 60 ? lastFrameUrl.slice(0, 60) + "…" : lastFrameUrl}</a>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function revealInExplorer(filePath) {
  try {
    const _req = getRequire();
    if (!_req) return;
    const cp = _req("child_process");
    // `explorer /select,"path"` highlights the file in Windows Explorer
    cp.exec(`explorer /select,"${filePath}"`);
  } catch (_) {}
}

async function saveVideoAs(videoUrl, taskId, setDlError, setSaveAsInfo) {
  try {
    const _req = getRequire();
    if (!_req) throw new Error("Node.js not available.");

    // Pick a destination via a hidden file input (HTML5 showSaveFilePicker isn't
    // available in CEP's Chromium build; we fall back to a prompt for the folder).
    // Simplest reliable path: ask the user for a folder via a native dialog if
    // available; otherwise fall back to a prompt.
    let targetDir = null;
    try {
      if (window.cep?.fs?.showOpenDialog) {
        // CEP API — directory picker (Adobe CEP 12)
        const res = window.cep.fs.showOpenDialogEx(false, true, "Choose a folder", "", [], false, true);
        if (res && res.data && res.data.length > 0) targetDir = res.data[0];
      }
    } catch (_) {}
    if (!targetDir) {
      targetDir = window.prompt("Save video to folder:", "");
      if (!targetDir) return;
    }

    const fs    = _req("fs");
    const path  = _req("path");
    const https = _req("https");
    const http  = _req("http");

    if (!fs.existsSync(targetDir)) {
      throw new Error(`Folder does not exist: ${targetDir}`);
    }

    const filename = `seedance_${taskId.slice(0, 8)}_${Date.now()}.mp4`;
    const destPath = path.join(targetDir, filename);

    setSaveAsInfo?.("Downloading…");
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(destPath);
      const doGet = (url) => {
        const mod = url.startsWith("https") ? https : http;
        mod.get(url, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            doGet(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            out.destroy();
            try { fs.unlinkSync(destPath); } catch (_) {}
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          res.pipe(out);
          out.on("finish", () => out.close(() => resolve()));
          out.on("error", reject);
        }).on("error", reject);
      };
      doGet(videoUrl);
    });
    setSaveAsInfo?.(`✓ Saved to: ${destPath}`);
  } catch (e) {
    setSaveAsInfo?.(null);
    setDlError?.(e.message);
  }
}
