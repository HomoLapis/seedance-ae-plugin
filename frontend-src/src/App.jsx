import { useState, useEffect, useCallback, useRef } from "react";
import {
  createGeneration,
  createGeneration15Pro,
  generateDepthVideo,
  generateOpenPoseVideo,
  generateImage,
  editImage,
  SEEDREAM_T2I_SIZES,
  SEEDANCE_1_5_PRO_RESOLUTIONS,
  SEEDANCE_1_5_PRO_RATIOS,
  // HappyHorse
  runHappyHorse,
  resolveImageToPublicUrl,
  uploadFileToTempHost,
  HAPPYHORSE_MODELS,
  HAPPYHORSE_RESOLUTIONS,
  HAPPYHORSE_RATIOS,
} from "./api.js";
import ImageUploader from "./components/ImageUploader.jsx";
import VideoUploader from "./components/VideoUploader.jsx";
import AudioUploader from "./components/AudioUploader.jsx";
import AssetHelper   from "./components/AssetHelper.jsx";
import VideoPopup    from "./components/VideoPopup.jsx";
import { downloadVideoToOutput } from "./utils/downloadVideo.js";
import { getOutputDir, makeTimestamp } from "./utils/outputDir.js";
import CostEstimator from "./components/CostEstimator.jsx";
import SpendingTracker from "./components/SpendingTracker.jsx";
import TaskStatus from "./components/TaskStatus.jsx";
import History from "./components/History.jsx";
import PromptAssistant from "./components/PromptAssistant.jsx";
import Settings from "./components/Settings.jsx";
import useAfterEffects from "./hooks/useAfterEffects.js";

// Two top-level generation modes mirror the BytePlus playground:
//   - "Reference generation" (mode="ref"): prompt + optional first frame +
//     optional omni-references (images/videos/audios). Covers t2v, i2v, and
//     omni-ref use-cases in a single, simpler UI.
//   - "First & Last Frame" (mode="i2v_fl"): first frame → last frame transition.
const GENERATION_MODES = [
  { id: "ref",    label: "Reference generation", desc: "Prompt + optional refs (image / video / audio)" },
  { id: "i2v_fl", label: "First & Last Frame",   desc: "Transition between two frames" },
];

// Seedance 2.0 officially supports 480p and 720p via BytePlus ModelArk API
const RESOLUTIONS = ["480p", "720p"];

const RATIOS_BY_RESOLUTION = {
  "480p": ["16:9", "9:16", "4:3", "3:4", "1:1"],
  "720p": ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"],
};

const RESOLUTION_DIMS = {
  "480p": { w: 854,  h: 480, label: "854×480"  },
  "720p": { w: 1280, h: 720, label: "1280×720" },
};

// Seedance 2.0 pricing (BytePlus ModelArk, no video input)
//   Standard: $7.00/M tokens
//   Fast:     $5.60/M tokens
// Token formula: (W × H × 24 × duration) / 1024
function computeEstimate({ resolution, duration }) {
  const dim = RESOLUTION_DIMS[resolution] || RESOLUTION_DIMS["720p"];
  const effDur = duration === -1 ? 5 : duration;
  const tokens = Math.round((dim.w * dim.h * 24 * effDur) / 1024);
  const modelKey   = localStorage.getItem("seedance_model") || "standard";
  const pricePerM  = modelKey === "fast" ? 5.60 : 7.00;
  const costUsd    = (tokens / 1_000_000) * pricePerM;
  return {
    tokens,
    cost_usd: costUsd,
    resolution_px: dim.label,
    duration,
    price_per_m_tokens: pricePerM,
  };
}

export default function App() {
  const [tab, setTab] = useState("video");

  const { isAE, aeReady, activeComp, activeCompInfo } = useAfterEffects();
  // Tracks whether we have already auto-selected the ratio for this comp,
  // so manual user changes aren't overwritten on the next AE poll.
  const autoRatioCompRef = useRef(null);

  // Form state. Internal modes still include "t2v"/"i2v" for compatibility
  // with history entries, but the UI only exposes "ref" and "i2v_fl".
  const [mode,          setMode]          = useState("ref");
  const [configureOpen, setConfigureOpen] = useState(true);
  const promptRef                         = useRef(null);

  // Insert a string at the current caret of the prompt textarea, preserving
  // selection range and adding surrounding whitespace where needed.
  const insertAtPromptCaret = (mention) => {
    const el = promptRef.current;
    if (!el) {
      setPrompt((p) => (p ? `${p} ${mention}` : mention));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    const before = el.value.slice(0, start);
    const after  = el.value.slice(end);
    const needLeadingSpace  = before && !/\s$/.test(before);
    const needTrailingSpace = after  && !/^\s/.test(after);
    const insert = `${needLeadingSpace ? " " : ""}${mention}${needTrailingSpace ? " " : ""}`;
    const next = before + insert + after;
    setPrompt(next);
    // restore caret after insertion
    requestAnimationFrame(() => {
      if (!promptRef.current) return;
      const pos = before.length + insert.length;
      promptRef.current.focus();
      promptRef.current.setSelectionRange(pos, pos);
    });
  };
  const [prompt,        setPrompt]        = useState("");
  const [resolution,    setResolution]    = useState("720p");
  const [ratio,         setRatio]         = useState("adaptive");
  const [duration,      setDuration]      = useState(5); // BytePlus default per docs: 5s
  const [generateAudio, setGenerateAudio] = useState(false);
  const [cameraFixed,   setCameraFixed]   = useState(false);
  const [watermark,     setWatermark]     = useState(false);
  const [returnLastFrame, setReturnLastFrame] = useState(false);
  const [seed,          setSeed]          = useState(-1);
  const [videoCount,    setVideoCount]    = useState(1);

  // First / last frame images (base64 upload or external URL)
  const [firstFrameUploadId, setFirstFrameUploadId] = useState(null);
  const [firstFrameUrl,      setFirstFrameUrl]      = useState("");
  const [lastFrameUploadId,  setLastFrameUploadId]  = useState(null);
  const [lastFrameUrl,       setLastFrameUrl]       = useState("");

  // Reference images (up to 9, omni-reference mode). Each slot: { upload, url }
  const [refImageSlots, setRefImageSlots] = useState([
    { upload: null, url: "" },
    { upload: null, url: "" },
    { upload: null, url: "" },
  ]);
  // Reference videos (up to 3) — local uploaded or external URL string
  const [refVideoSlots, setRefVideoSlots] = useState([""]);
  // Reference audios (up to 3) — external URL (string)
  const [refAudioSlots, setRefAudioSlots] = useState([""]);

  const updateRefImage = (idx, patch) => {
    setRefImageSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const addRefImage    = () => setRefImageSlots((prev) => (prev.length < 9 ? [...prev, { upload: null, url: "" }] : prev));
  const removeRefImage = (idx) => setRefImageSlots((prev) => prev.filter((_, i) => i !== idx));

  const updateRefVideo = (idx, val) => {
    setRefVideoSlots((prev) => prev.map((v, i) => (i === idx ? val : v)));
    // When the underlying video is cleared, drop any depth/pose mapping
    // generated from it — the result no longer applies to anything.
    if (!val || !val.trim()) {
      setControlState((s) => {
        const next = { ...s };
        delete next[`depth-${idx}`];
        delete next[`pose-${idx}`];
        return next;
      });
    }
  };
  const addRefVideo    = () => setRefVideoSlots((prev) => (prev.length < 3 ? [...prev, ""] : prev));
  const removeRefVideo = (idx) => {
    setRefVideoSlots((prev) => prev.filter((_, i) => i !== idx));
    setControlState((s) => {
      const next = { ...s };
      delete next[`depth-${idx}`];
      delete next[`pose-${idx}`];
      return next;
    });
  };
  const clearControlResult = (type, idx) => {
    setControlState((s) => {
      const next = { ...s };
      delete next[`${type}-${idx}`];
      return next;
    });
  };

  const updateRefAudio = (idx, val) => setRefAudioSlots((prev) => prev.map((v, i) => (i === idx ? val : v)));
  const addRefAudio    = () => setRefAudioSlots((prev) => (prev.length < 3 ? [...prev, ""] : prev));
  const removeRefAudio = (idx) => setRefAudioSlots((prev) => prev.filter((_, i) => i !== idx));

  // Asset helper modal target: callback that receives the asset:// URI.
  // Pass a no-op for "informational" mode (modal still lets the user paste an
  // ID and hit Use, but nothing in the form gets pre-filled).
  // assetModalTarget holds { callback, suggestedKind } (or null when closed).
  const [assetModalTarget, setAssetModalTarget] = useState(null);
  const openAssetHelperInfo = () =>
    setAssetModalTarget({ callback: () => {}, suggestedKind: "character" });
  const openAssetPicker = (callback, suggestedKind = "character") =>
    setAssetModalTarget({ callback, suggestedKind });
  // Video popup: { src, title } when shown
  const [videoPopup, setVideoPopup] = useState(null);
  // Controlnet preprocessor state, keyed by `${type}-${idx}` where type is
  // "depth" or "pose". Each entry: { busy, stage, error, done, url, localPath, aeStatus }.
  const [controlState, setControlState] = useState({});

  const CONTROL_RUNNERS = {
    depth: { fn: generateDepthVideo,    label: "Depth map",     prefix: "depth_ref", layerPrefix: "Depth Ref" },
    pose:  { fn: generateOpenPoseVideo, label: "Pose skeleton", prefix: "pose_ref",  layerPrefix: "Pose Ref"  },
  };

  const runControl = async (type, idx, url) => {
    const key = `${type}-${idx}`;
    const cfg = CONTROL_RUNNERS[type];
    if (!cfg) return;
    if (!url || !url.trim() || !url.startsWith("http")) {
      setControlState((s) => ({ ...s, [key]: { type, error: "Paste a public HTTPS URL first." }}));
      return;
    }
    setControlState((s) => ({ ...s, [key]: { type, busy: true, stage: "submitting" }}));
    try {
      const outUrl = await cfg.fn(url.trim(), (stage) => {
        setControlState((s) => ({ ...s, [key]: { type, busy: true, stage }}));
      });

      // Use the fal.ai HTTPS URL directly as the reference video
      updateRefVideo(idx, outUrl);

      // Download for preview + AE import
      setControlState((s) => ({ ...s, [key]: { type, busy: true, stage: "downloading", url: outUrl }}));
      let localPath = null;
      try {
        localPath = await downloadVideoToOutput(outUrl, { subdir: "video", prefix: cfg.prefix });
      } catch (dlErr) {
        console.warn(`${cfg.label} download failed:`, dlErr);
      }

      setControlState((s) => ({
        ...s,
        [key]: { type, done: true, url: outUrl, localPath, aeStatus: null },
      }));
    } catch (e) {
      setControlState((s) => ({ ...s, [key]: { type, error: e.message }}));
    }
  };

  const importControlToAE = async (type, idx) => {
    const key = `${type}-${idx}`;
    const cfg = CONTROL_RUNNERS[type];
    const d = controlState[key];
    if (!d?.localPath || !cfg) return;
    setControlState((s) => ({ ...s, [key]: { ...d, aeStatus: "importing" }}));
    try {
      if (!window.AEBridge?.isInAfterEffects?.()) {
        throw new Error("Not running inside After Effects.");
      }
      const r = await window.AEBridge.importAndAddToTimeline(
        d.localPath,
        `${cfg.layerPrefix} ${idx + 1}`
      );
      if (r?.error) throw new Error(r.error);
      setControlState((s) => ({
        ...s,
        [key]: { ...d, aeStatus: `✓ Added "${r.layerName}" to ${r.compName}` },
      }));
    } catch (e) {
      setControlState((s) => ({ ...s, [key]: { ...d, aeStatus: `Error: ${e.message}` }}));
    }
  };

  // ── Image tab state ──────────────────────────────────────────────────────
  const [imgMode,        setImgMode]        = useState("t2i"); // "t2i" | "i2i"
  const [imgPrompt,      setImgPrompt]      = useState("");
  const [imgSize,        setImgSize]        = useState("1024x1024");
  const [imgSeed,        setImgSeed]        = useState(-1);
  const [imgInput,       setImgInput]       = useState("");   // base64 data URL or http URL
  const [imgInputName,   setImgInputName]   = useState("");
  const [imgResult,      setImgResult]      = useState(null); // base64 data URL
  const [imgResultPath,  setImgResultPath]  = useState(null); // saved disk path
  const [imgGenerating,  setImgGenerating]  = useState(false);
  const [imgError,       setImgError]       = useState(null);
  const [imgAeStatus,    setImgAeStatus]    = useState(null);
  const [imgPsStatus,    setImgPsStatus]    = useState(null);
  const imgFileRef = useRef(null);

  const runImageGenerate = async () => {
    if (!imgPrompt.trim()) return;
    if (imgMode === "i2i" && !imgInput) {
      setImgError("Image-edit mode requires an input image. Drop one or paste a URL.");
      return;
    }
    setImgGenerating(true);
    setImgError(null);
    setImgResult(null);
    setImgResultPath(null);
    setImgAeStatus(null);
    setImgPsStatus(null);
    try {
      let dataUrl;
      if (imgMode === "i2i") {
        dataUrl = await editImage(imgInput, imgPrompt.trim());
      } else {
        dataUrl = await generateImage(imgPrompt.trim(), {
          size: imgSize,
          seed: Number.isFinite(imgSeed) && imgSeed >= 0 ? imgSeed : undefined,
        });
      }
      setImgResult(dataUrl);

      // Auto-save to output dir for AE/Photoshop
      try {
        const _req = (typeof window !== "undefined" && window.require) || (typeof require !== "undefined" ? require : null);
        if (_req) {
          const fs   = _req("fs");
          const path = _req("path");
          const dir  = await getOutputDir("image");
          if (dir) {
            const filePath = path.join(dir, `seedream_${makeTimestamp()}.png`);
            const b64 = dataUrl.split(",")[1] || "";
            fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
            setImgResultPath(filePath);
          }
        }
      } catch (saveErr) {
        console.warn("Auto-save failed:", saveErr);
      }
    } catch (e) {
      setImgError(e.message);
    } finally {
      setImgGenerating(false);
    }
  };

  const handleImgFileDrop = (file) => {
    if (!file) return;
    setImgError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      setImgInput(e.target.result);
      setImgInputName(file.name);
      if (imgMode === "t2i") setImgMode("i2i");
    };
    reader.readAsDataURL(file);
  };

  const importImageToAE = async () => {
    if (!imgResultPath) {
      setImgAeStatus("Image not saved yet. Wait for the auto-save to finish.");
      return;
    }
    if (!window.AEBridge?.isInAfterEffects?.()) {
      setImgAeStatus("Not running inside After Effects.");
      return;
    }
    setImgAeStatus("importing");
    try {
      const r = await window.AEBridge.importImageAndAddToTimeline(imgResultPath, "Seedream", 5);
      if (r?.error) throw new Error(r.error);
      setImgAeStatus(`✓ Added "${r.layerName}" to ${r.compName}`);
    } catch (e) {
      setImgAeStatus(`Error: ${e.message}`);
    }
  };

  const openImgInPhotoshop = async () => {
    if (!imgResultPath) {
      setImgPsStatus("Image not saved yet.");
      return;
    }
    setImgPsStatus("opening");
    try {
      const _req = (typeof window !== "undefined" && window.require) || (typeof require !== "undefined" ? require : null);
      if (!_req) throw new Error("Node.js not available.");
      const cp = _req("child_process");
      // Try common Photoshop versions on Windows; fall back to "start" association.
      const candidates = [
        `"C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe"`,
        `"C:\\Program Files\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe"`,
        `"C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe"`,
        `"C:\\Program Files\\Adobe\\Adobe Photoshop 2023\\Photoshop.exe"`,
        `"C:\\Program Files\\Adobe\\Adobe Photoshop 2022\\Photoshop.exe"`,
      ];
      const path = _req("path");
      const fs   = _req("fs");
      let opened = false;
      for (const exe of candidates) {
        const clean = exe.replace(/"/g, "");
        if (fs.existsSync(clean)) {
          cp.spawn(clean, [imgResultPath], { detached: true, stdio: "ignore" }).unref();
          opened = true;
          break;
        }
      }
      if (!opened) {
        // Fall back to OS default association for .png
        cp.exec(`start "" "${imgResultPath}"`);
      }
      setImgPsStatus("✓ Sent to Photoshop");
    } catch (e) {
      setImgPsStatus(`Error: ${e.message}`);
    }
  };

  const useImgAsRef = () => {
    if (!imgResult) return;
    // Add to first empty image-reference slot, or first slot if all full
    setRefImageSlots((prev) => {
      const idx = prev.findIndex((s) => !s.upload && !s.url);
      if (idx >= 0) return prev.map((s, i) => i === idx ? { upload: imgResult, url: "" } : s);
      return prev.map((s, i) => i === 0 ? { upload: imgResult, url: "" } : s);
    });
    setMode("ref");
    setTab("video");
  };

  // ── Seedance 1.5 Pro tab state (legacy model, dedicated UI) ─────────────
  const [v15Mode,         setV15Mode]         = useState("t2v"); // t2v | i2v | flf
  const [v15Prompt,       setV15Prompt]       = useState("");
  const [v15Resolution,   setV15Resolution]   = useState("720p");
  const [v15Ratio,        setV15Ratio]        = useState("16:9");
  const [v15Duration,     setV15Duration]     = useState(5);
  const [v15CameraFixed,  setV15CameraFixed]  = useState(false);
  const [v15Audio,        setV15Audio]        = useState(false);
  const [v15Watermark,    setV15Watermark]    = useState(false);
  const [v15Seed,         setV15Seed]         = useState(-1);
  const [v15FirstUpload,  setV15FirstUpload]  = useState(null);
  const [v15FirstUrl,     setV15FirstUrl]     = useState("");
  const [v15LastUpload,   setV15LastUpload]   = useState(null);
  const [v15LastUrl,      setV15LastUrl]      = useState("");
  const [v15Generating,   setV15Generating]   = useState(false);
  const [v15Error,        setV15Error]        = useState(null);
  const [v15ActiveTasks,  setV15ActiveTasks]  = useState([]);

  // ── HappyHorse tab state (Alibaba Cloud / DashScope) ────────────────────
  // Per the four official model docs, HappyHorse exposes 4 distinct models
  // (t2v / i2v / r2v / video-edit) sharing the same /video-synthesis endpoint
  // but with different inputs and constraints.
  const [hhMode,         setHhMode]         = useState("t2v"); // t2v | i2v | r2v | edit
  const [hhPrompt,       setHhPrompt]       = useState("");
  const [hhResolution,   setHhResolution]   = useState("720P");
  const [hhRatio,        setHhRatio]        = useState("16:9");
  const [hhDuration,     setHhDuration]     = useState(5);     // 3-15 (t2v/i2v/r2v); ignored by edit
  const [hhWatermark,    setHhWatermark]    = useState(false); // Docs default true; we default to false (most users want clean output)
  const [hhSeed,         setHhSeed]         = useState(-1);    // -1 = random
  const [hhAudioSetting, setHhAudioSetting] = useState("auto"); // auto | origin (video-edit only)

  // i2v: single first-frame image (data URL, http URL, or file)
  const [hhFirstFrame,   setHhFirstFrame]   = useState("");

  // r2v: 1-9 reference images
  const [hhRefSlots,     setHhRefSlots]     = useState([{ upload: null, url: "" }]);

  // edit: input video (1) + 0-5 ref images
  const [hhEditVideo,    setHhEditVideo]    = useState("");
  const [hhEditRefSlots, setHhEditRefSlots] = useState([]);

  const [hhBusy,         setHhBusy]         = useState(false);
  const [hhStage,        setHhStage]        = useState(null);  // textual progress
  const [hhError,        setHhError]        = useState(null);
  const [hhResult,       setHhResult]       = useState(null);  // { task_id, video_url, ... }
  const [hhLocalPath,    setHhLocalPath]    = useState(null);  // saved file path
  const [hhAeStatus,     setHhAeStatus]     = useState(null);

  const updateHhRef     = (idx, patch) =>
    setHhRefSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const addHhRef        = () =>
    setHhRefSlots((prev) => (prev.length < 9 ? [...prev, { upload: null, url: "" }] : prev));
  const removeHhRef     = (idx) =>
    setHhRefSlots((prev) => prev.filter((_, i) => i !== idx));

  const updateHhEditRef = (idx, patch) =>
    setHhEditRefSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const addHhEditRef    = () =>
    setHhEditRefSlots((prev) => (prev.length < 5 ? [...prev, { upload: null, url: "" }] : prev));
  const removeHhEditRef = (idx) =>
    setHhEditRefSlots((prev) => prev.filter((_, i) => i !== idx));

  /**
   * Build the HappyHorse request payload from current state and submit it.
   * Uploads any local data-URL / file inputs to tmpfiles.org first because
   * the DashScope API requires public HTTPS URLs.
   */
  const runHhGenerate = async () => {
    if (!hhPrompt.trim() && hhMode !== "i2v") return; // i2v allows empty prompt
    setHhBusy(true);
    setHhError(null);
    setHhResult(null);
    setHhLocalPath(null);
    setHhAeStatus(null);
    try {
      // 1) Resolve all media inputs to public URLs
      const media = [];
      if (hhMode === "i2v") {
        if (!hhFirstFrame) throw new Error("Image-to-video mode requires a first-frame image.");
        setHhStage("Uploading first frame…");
        const url = await resolveImageToPublicUrl(hhFirstFrame);
        media.push({ type: "first_frame", url });
      } else if (hhMode === "r2v") {
        const refs = hhRefSlots.map((s) => s.upload || s.url || null).filter(Boolean);
        if (refs.length === 0) throw new Error("Reference-to-video mode requires 1-9 reference images.");
        if (refs.length > 9)   throw new Error("Reference-to-video accepts at most 9 images.");
        setHhStage(`Uploading ${refs.length} reference image(s)…`);
        for (const r of refs) {
          const url = await resolveImageToPublicUrl(r);
          media.push({ type: "reference_image", url });
        }
      } else if (hhMode === "edit") {
        if (!hhEditVideo) throw new Error("Video-edit mode requires an input video URL.");
        if (!/^https?:\/\//i.test(hhEditVideo)) {
          throw new Error("Video-edit input must be a public HTTPS URL (HappyHorse does not accept base64 video).");
        }
        media.push({ type: "video", url: hhEditVideo });
        const refs = hhEditRefSlots.map((s) => s.upload || s.url || null).filter(Boolean);
        if (refs.length > 5) throw new Error("Video-edit accepts at most 5 reference images.");
        if (refs.length > 0) setHhStage(`Uploading ${refs.length} reference image(s)…`);
        for (const r of refs) {
          const url = await resolveImageToPublicUrl(r);
          media.push({ type: "reference_image", url });
        }
      }

      // 2) Build payload per docs
      const input = { prompt: hhPrompt.trim() };
      if (media.length > 0) input.media = media;

      const parameters = {
        watermark: hhWatermark,
      };
      if (Number.isFinite(hhSeed) && hhSeed >= 0) parameters.seed = hhSeed;
      if (hhMode !== "edit") {
        parameters.resolution = hhResolution;
        parameters.duration   = hhDuration;
      } else {
        parameters.resolution    = hhResolution;
        parameters.audio_setting = hhAudioSetting;
      }
      // ratio: only valid for t2v and r2v (i2v auto-follows image; edit doesn't accept it)
      if (hhMode === "t2v" || hhMode === "r2v") {
        parameters.ratio = hhRatio;
      }

      const payload = {
        model: HAPPYHORSE_MODELS[hhMode],
        input,
        parameters,
      };

      // 3) Run with progress
      setHhStage("Submitting task to HappyHorse…");
      const result = await runHappyHorse(payload, {
        onProgress: ({ stage, task_id }) => {
          if (stage === "submitting")     setHhStage("Submitting task…");
          else if (stage === "queued")    setHhStage(`Queued (task ${task_id?.slice(0, 8)}…)`);
          else if (stage === "running")   setHhStage("Generating video…");
          else if (stage === "succeeded") setHhStage("Downloading…");
          else if (stage === "poll_error") setHhStage("Network glitch, retrying…");
          else                            setHhStage(stage);
        },
      });
      setHhResult(result);

      // 4) Auto-download to project/Seedance/video for parity with Seedance flow
      try {
        const filePath = await downloadVideoToOutput(result.video_url, {
          subdir: "video",
          prefix: `happyhorse_${hhMode}`,
        });
        setHhLocalPath(filePath);
      } catch (dlErr) {
        console.warn("HappyHorse download failed:", dlErr);
      }

      // 5) Add to history (parity with Seedance video tab)
      setHistory((prev) => [{
        taskId:        result.task_id,
        createdAt:     Date.now(),
        prompt:        hhPrompt.trim(),
        mode:          `hh-${hhMode}`,
        resolution:    hhResolution,
        ratio:         (hhMode === "t2v" || hhMode === "r2v") ? hhRatio : null,
        duration:      hhMode !== "edit" ? hhDuration : null,
        watermark:     hhWatermark,
        seed:          hhSeed,
        videoUrl:      result.video_url,
        estimatedCost: 0,
        status:        "succeeded",
        modelFamily:   "happyhorse-1.0",
      }, ...prev]);
    } catch (e) {
      setHhError(e.message);
    } finally {
      setHhBusy(false);
      setHhStage(null);
    }
  };

  const importHhToAE = async () => {
    if (!hhLocalPath) {
      setHhAeStatus("Video not yet saved locally.");
      return;
    }
    if (!window.AEBridge?.isInAfterEffects?.()) {
      setHhAeStatus("Not running inside After Effects.");
      return;
    }
    setHhAeStatus("importing");
    try {
      const r = await window.AEBridge.importAndAddToTimeline(hhLocalPath, "HappyHorse");
      if (r?.error) throw new Error(r.error);
      setHhAeStatus(`✓ Added "${r.layerName}" to ${r.compName}`);
    } catch (e) {
      setHhAeStatus(`Error: ${e.message}`);
    }
  };

  const runV15Generate = async () => {
    if (!v15Prompt.trim()) return;
    setV15Generating(true);
    setV15Error(null);
    try {
      const params = {
        prompt:         v15Prompt.trim(),
        resolution:     v15Resolution,
        ratio:          v15Ratio,
        duration:       v15Duration,
        camera_fixed:   v15CameraFixed,
        generate_audio: v15Audio,
        watermark:      v15Watermark,
        seed:           v15Seed,
      };
      if (v15Mode === "i2v" || v15Mode === "flf") {
        if (v15FirstUpload) params.first_frame_upload_id = v15FirstUpload;
        else if (v15FirstUrl) params.first_frame_url = v15FirstUrl;
      }
      if (v15Mode === "flf") {
        if (v15LastUpload) params.last_frame_upload_id = v15LastUpload;
        else if (v15LastUrl) params.last_frame_url = v15LastUrl;
      }
      const { task } = await createGeneration15Pro(params);
      if (task?.id) {
        setV15ActiveTasks((t) => [task.id, ...t]);
        setHistory((prev) => [{
          taskId:        task.id,
          createdAt:     Date.now(),
          prompt:        v15Prompt.trim(),
          mode:          `1.5-${v15Mode}`,
          resolution:    v15Resolution,
          ratio:         v15Ratio,
          duration:      v15Duration,
          audio:         v15Audio,
          cameraFixed:   v15CameraFixed,
          watermark:     v15Watermark,
          seed:          v15Seed,
          estimatedCost: 0,
          status:        "running",
          modelFamily:   "seedance-1.5-pro",
        }, ...prev]);
      }
    } catch (e) {
      setV15Error(e.message);
    } finally {
      setV15Generating(false);
    }
  };

  // Cost estimate
  const [estimate, setEstimate] = useState(null);

  // Generation state
  const [generating,   setGenerating]   = useState(false);
  const [activeTasks,  setActiveTasks]  = useState([]);
  const [genError,     setGenError]     = useState(null);

  // Session tracking — persisted across panel reloads
  const [totalSpent, setTotalSpent] = useState(() => {
    const v = parseFloat(localStorage.getItem("seedance_total_spent") || "0");
    return Number.isFinite(v) ? v : 0;
  });
  const [history, setHistory] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("seedance_history") || "[]");
      // Defensive migration: strip any data URLs that slipped in before the
      // quota fix, so reload doesn't inherit a multi-megabyte blob.
      const strip = (v) => (typeof v === "string" && v.startsWith("data:") ? "__data_url__" : v);
      return (Array.isArray(parsed) ? parsed : []).map((h) => ({
        ...h,
        firstFrameUploadId: strip(h?.firstFrameUploadId),
        lastFrameUploadId:  strip(h?.lastFrameUploadId),
        refImageSlots: Array.isArray(h?.refImageSlots)
          ? h.refImageSlots.map((s) => ({
              upload: strip(s?.upload),
              url:    s?.url || "",
            }))
          : h?.refImageSlots,
      }));
    } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem("seedance_total_spent", String(totalSpent));
  }, [totalSpent]);
  useEffect(() => {
    // Keep history bounded AND strip heavy payloads (base64 data URLs) before
    // persisting — otherwise multiple reference images can push localStorage
    // over its ~5MB quota, which throws and crashes the React tree (the UI
    // goes black).
    const stripDataUrls = (v) => {
      if (typeof v !== "string") return v;
      return v.startsWith("data:") ? "__data_url__" : v;
    };
    const lean = history.slice(0, 100).map((h) => ({
      ...h,
      firstFrameUploadId: stripDataUrls(h.firstFrameUploadId),
      lastFrameUploadId:  stripDataUrls(h.lastFrameUploadId),
      refImageSlots: Array.isArray(h.refImageSlots)
        ? h.refImageSlots.map((s) => ({
            upload: stripDataUrls(s?.upload),
            url:    s?.url || "",
          }))
        : h.refImageSlots,
    }));
    try {
      localStorage.setItem("seedance_history", JSON.stringify(lean));
    } catch (e) {
      // Quota exceeded or serialization failed — keep only the 20 most recent
      // to stay under 5MB, and still guard against exceptions.
      try {
        localStorage.setItem("seedance_history", JSON.stringify(lean.slice(0, 20)));
      } catch (_) {
        console.warn("Failed to persist history:", e.message);
      }
    }
  }, [history]);

  useEffect(() => {
    setEstimate(computeEstimate({ resolution, duration }));
  }, [resolution, duration]);

  // Auto-select the closest Seedance ratio to the active AE comp the first
  // time we see a given comp. We snap to the nearest of 21:9, 16:9, 4:3, 1:1,
  // 3:4, 9:16. If the user manually overrides afterwards, we don't fight them
  // — autoRatioCompRef tracks the comp we auto-set and we only retrigger when
  // a NEW comp becomes active.
  useEffect(() => {
    if (!activeCompInfo) return;
    const compKey = `${activeCompInfo.name}|${activeCompInfo.width}x${activeCompInfo.height}`;
    if (autoRatioCompRef.current === compKey) return; // already auto-set for this comp
    autoRatioCompRef.current = compKey;

    const aspect = activeCompInfo.width / activeCompInfo.height;
    const candidates = [
      { id: "21:9", v: 21 / 9  },
      { id: "16:9", v: 16 / 9  },
      { id: "4:3",  v: 4 / 3   },
      { id: "1:1",  v: 1       },
      { id: "3:4",  v: 3 / 4   },
      { id: "9:16", v: 9 / 16  },
    ];
    let best = candidates[0];
    let bestDelta = Math.abs(Math.log(aspect / best.v));
    for (const c of candidates) {
      const d = Math.abs(Math.log(aspect / c.v));
      if (d < bestDelta) { best = c; bestDelta = d; }
    }
    // Only set if available in the current resolution's ratio list
    if ((RATIOS_BY_RESOLUTION[resolution] || []).includes(best.id)) {
      setRatio(best.id);
    }
    // Same for the 1.5 Pro tab — supports the same ratios + always 480p/720p/1080p
    if (SEEDANCE_1_5_PRO_RATIOS.includes(best.id)) {
      setV15Ratio(best.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompInfo]);

  // Keep ratio valid when resolution changes
  const availableRatios = ["adaptive", ...RATIOS_BY_RESOLUTION[resolution] || []];
  useEffect(() => {
    if (!availableRatios.includes(ratio)) setRatio("adaptive");
  }, [resolution]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    const arkKey = localStorage.getItem("seedance_ark_key") || "";
    if (!arkKey) {
      setGenError("No ARK API key set — go to Settings to add your BytePlus API key.");
      return;
    }

    setGenerating(true);
    setGenError(null);
    setActiveTasks([]);

    const baseParams = {
      mode,
      prompt:            prompt.trim(),
      resolution,
      ratio,
      duration,
      generate_audio:    generateAudio,
      camera_fixed:      cameraFixed,
      watermark:         watermark,
      return_last_frame: returnLastFrame,
      seed:              Number.isFinite(seed) ? seed : -1,
    };

    // Image-to-video (first frame only) — legacy i2v mode
    if (mode === "i2v") {
      if (firstFrameUploadId) baseParams.first_frame_upload_id = firstFrameUploadId;
      else if (firstFrameUrl) baseParams.first_frame_url = firstFrameUrl;
    }

    // First & last frame — two mandatory images with strict roles
    if (mode === "i2v_fl") {
      if (firstFrameUploadId) baseParams.first_frame_upload_id = firstFrameUploadId;
      else if (firstFrameUrl) baseParams.first_frame_url = firstFrameUrl;
      if (lastFrameUploadId)  baseParams.last_frame_upload_id  = lastFrameUploadId;
      else if (lastFrameUrl)  baseParams.last_frame_url        = lastFrameUrl;
    }

    // Multimodal reference mode — per docs, all images here use role
    // `reference_image`; first/last frame roles are NOT used here. If the
    // user wants first/last frame behavior inside ref mode, they must cite
    // the image in the prompt ("use Image 1 as the first frame"), not change
    // the role.
    if (mode === "ref" || mode === "t2v") {
      const refs = refImageSlots.map((s) => s.upload || s.url || null).filter(Boolean);
      if (refs.length > 0) baseParams.ref_images = refs;

      const vids = refVideoSlots.map((v) => v.trim()).filter(Boolean);
      if (vids.length > 0) baseParams.ref_videos = vids;

      const auds = refAudioSlots.map((a) => a.trim()).filter(Boolean);
      if (auds.length > 0) baseParams.ref_audios = auds;
    }

    try {
      const promises = Array.from({ length: videoCount }, () =>
        createGeneration({ ...baseParams })
      );
      const results = await Promise.allSettled(promises);

      const newTaskIds    = [];
      const newHistoryItems = [];
      let addedCost = 0;

      for (const result of results) {
        if (result.status === "fulfilled") {
          const taskId = result.value.task?.id;
          if (taskId) {
            newTaskIds.push(taskId);
            const cost = estimate?.cost_usd || 0;
            addedCost += cost;
            newHistoryItems.push({
              taskId,
              createdAt: Date.now(),
              prompt: prompt.trim(),
              mode,
              resolution,
              ratio,
              duration,
              audio: generateAudio,
              cameraFixed,
              watermark,
              returnLastFrame,
              seed,
              // Capture full asset state so "reuse settings" can restore
              firstFrameUploadId,
              firstFrameUrl,
              lastFrameUploadId,
              lastFrameUrl,
              refImageSlots: refImageSlots.map((s) => ({ ...s })),
              refVideoSlots: [...refVideoSlots],
              refAudioSlots: [...refAudioSlots],
              estimatedCost: cost,
              status: "running",
            });
          }
        }
      }

      if (newTaskIds.length > 0) {
        setActiveTasks(newTaskIds);
        setHistory((prev) => [...newHistoryItems, ...prev]);
        setTotalSpent((prev) => prev + addedCost);
      }

      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        setGenError(`${failures.length}/${videoCount} task(s) failed: ${failures[0].reason?.message}`);
      }
    } catch (e) {
      setGenError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleTaskComplete = useCallback((result) => {
    const task = result.task || {};
    const videoUrl =
      task.content?.video_url || task.content?.url ||
      task.output?.video_url  || task.output?.url  || null;
    const lastFrameUrl =
      task.content?.last_frame_url || task.output?.last_frame_url || null;
    setHistory((prev) =>
      prev.map((h) =>
        h.taskId === task.id
          ? { ...h, status: task.status || "succeeded", videoUrl, lastFrameUrl }
          : h
      )
    );
  }, []);

  /**
   * Restore a history entry into the form for re-generation / editing.
   * Switches to the Video tab and pre-fills every captured parameter.
   * Uploaded images (base64 data URLs) are stripped from persisted history
   * to stay under the localStorage quota — on restore, the "__data_url__"
   * placeholder is ignored and the user is expected to re-attach the image.
   */
  const restoreFromHistory = (item) => {
    if (!item) return;
    const unwrap = (v) => (v === "__data_url__" ? null : v);
    setTab("video");
    // Collapse legacy 4-mode history entries onto the new 2-mode UI.
    if (item.mode) {
      const legacyMap = { t2v: "ref", i2v: "ref", ref: "ref", i2v_fl: "i2v_fl" };
      setMode(legacyMap[item.mode] || "ref");
    }
    setPrompt(item.prompt || "");
    if (item.resolution) setResolution(item.resolution);
    if (item.ratio) setRatio(item.ratio);
    if (Number.isFinite(item.duration)) setDuration(item.duration);
    setGenerateAudio(!!item.audio);
    setCameraFixed(!!item.cameraFixed);
    setWatermark(!!item.watermark);
    setReturnLastFrame(!!item.returnLastFrame);
    if (Number.isFinite(item.seed)) setSeed(item.seed);
    setFirstFrameUploadId(unwrap(item.firstFrameUploadId));
    setFirstFrameUrl(item.firstFrameUrl || "");
    setLastFrameUploadId(unwrap(item.lastFrameUploadId));
    setLastFrameUrl(item.lastFrameUrl || "");
    if (Array.isArray(item.refImageSlots) && item.refImageSlots.length > 0) {
      setRefImageSlots(item.refImageSlots.map((s) => ({
        upload: unwrap(s?.upload),
        url:    s?.url || "",
      })));
    }
    if (Array.isArray(item.refVideoSlots) && item.refVideoSlots.length > 0) {
      setRefVideoSlots([...item.refVideoSlots]);
    }
    if (Array.isArray(item.refAudioSlots) && item.refAudioSlots.length > 0) {
      setRefAudioSlots([...item.refAudioSlots]);
    }
  };

  // Derive ref images array for prompt assistant
  const refImages = refImageSlots.map((s) => s.upload || s.url || null).filter(Boolean);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-3 sm:px-4 py-2.5 flex-shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-white leading-tight">Seedance Studio</h1>
              <p className="text-[10px] text-zinc-500 leading-tight">Video & Image generation for After Effects</p>
            </div>
          </div>

          <nav className="flex rounded-lg overflow-hidden border border-zinc-700 order-3 sm:order-2 w-full sm:w-auto">
            {[
              { id: "video",    label: "Video 2.0",icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" },
              { id: "video15",  label: "Video 1.5",icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" },
              { id: "happyhorse", label: "🐎 HappyHorse", icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" },
              { id: "image",    label: "Image",    icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" },
              { id: "history",  label: "History",  icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
              { id: "settings", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs transition ${
                  tab === t.id
                    ? "bg-brand-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={t.icon} />
                </svg>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>

          {isAE && (
            <div className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border order-2 sm:order-3 ${
              aeReady
                ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                : "border-zinc-700 bg-zinc-800 text-zinc-500"
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${aeReady ? "bg-blue-400" : "bg-zinc-600"}`} />
              {aeReady ? (activeComp ? `AE: ${activeComp}` : "AE: No comp") : "AE: Disconnected"}
            </div>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 px-3 sm:px-4 lg:px-6 py-3 sm:py-4 overflow-y-auto max-w-[1600px] w-full mx-auto">
        {/* Settings tab — rendered but hidden when on generate tab, preserving state */}
        <div style={{ display: tab === "settings" ? "block" : "none" }}>
          <Settings onOpenAssetHelper={openAssetHelperInfo} />
        </div>
        <div style={{ display: tab === "video" ? "block" : "none" }}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* ── LEFT column: form ── */}
            <div className="space-y-4 min-w-0">

            {/* ── Configure panel — collapsible, at the top of the form ── */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              {/* Header always visible */}
              <button
                onClick={() => setConfigureOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-zinc-800/50 transition"
                aria-expanded={configureOpen}
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">Configure</h3>
                  {/* Summary when collapsed: show current params inline */}
                  {!configureOpen && (
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                      <span>{resolution}</span>
                      <span>·</span>
                      <span>{ratio}</span>
                      <span>·</span>
                      <span>{duration === -1 ? "smart" : `${duration}s`}</span>
                      <span>·</span>
                      <span>{videoCount}×</span>
                      {generateAudio && <span>· 🔊</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[9px] text-zinc-500 uppercase tracking-wider leading-none">Estimated cost</div>
                    <div className="text-xs font-mono text-amber-300 leading-tight">
                      {estimate ? `$${estimate.cost_usd.toFixed(4)}` : "—"}
                      {videoCount > 1 && estimate && (
                        <span className="text-zinc-500 text-[10px]"> × {videoCount}</span>
                      )}
                    </div>
                  </div>
                  <svg
                    className={`w-4 h-4 text-zinc-400 transition-transform ${configureOpen ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Body — revealed when expanded */}
              {configureOpen && (
                <div className="px-3 pb-3 pt-1 space-y-3 border-t border-zinc-800">

                  {/* Generation mode */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Generation mode</label>
                    <div className="grid grid-cols-2 gap-1">
                      {GENERATION_MODES.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => setMode(m.id)}
                          title={m.desc}
                          className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition border ${
                            (mode === m.id || (m.id === "ref" && (mode === "t2v" || mode === "i2v")))
                              ? "border-brand-500 bg-brand-500/10 text-brand-300"
                              : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                          }`}
                        >{m.label}</button>
                      ))}
                    </div>
                  </div>

                  {/* Ratio */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Ratio</label>
                    <div className="grid grid-cols-3 gap-1">
                      {availableRatios.filter((r) => r !== "adaptive").map((r) => (
                        <button
                          key={r}
                          onClick={() => setRatio(r)}
                          className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition border ${
                            ratio === r
                              ? "border-brand-500 bg-brand-500/10 text-brand-300"
                              : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                          }`}
                        >{r}</button>
                      ))}
                      {availableRatios.includes("adaptive") && (
                        <button
                          onClick={() => setRatio("adaptive")}
                          className={`col-span-3 px-2 py-1.5 rounded-lg text-[11px] font-medium transition border ${
                            ratio === "adaptive"
                              ? "border-brand-500 bg-brand-500/10 text-brand-300"
                              : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                          }`}
                        >Auto (adaptive)</button>
                      )}
                    </div>
                  </div>

                  {/* Resolution */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Resolution</label>
                    <div className="grid grid-cols-2 gap-1">
                      {RESOLUTIONS.map((r) => (
                        <button
                          key={r}
                          onClick={() => setResolution(r)}
                          className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition border ${
                            resolution === r
                              ? "border-brand-500 bg-brand-500/10 text-brand-300"
                              : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                          }`}
                        >{r}</button>
                      ))}
                    </div>
                  </div>

                  {/* Duration — min 4s per Seedance 2.0 spec */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Duration</label>
                      <div className="flex rounded-md overflow-hidden border border-zinc-700 text-[10px]">
                        <button
                          onClick={() => setDuration(duration === -1 ? 5 : duration)}
                          className={`px-2 py-0.5 ${duration !== -1 ? "bg-zinc-700 text-white" : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
                        >Seconds</button>
                        <button
                          onClick={() => setDuration(-1)}
                          className={`px-2 py-0.5 ${duration === -1 ? "bg-zinc-700 text-white" : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
                        >Smart length</button>
                      </div>
                    </div>
                    {duration !== -1 && (
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={4}
                          max={15}
                          value={Math.max(4, duration)}
                          onChange={(e) => setDuration(parseInt(e.target.value))}
                          className="flex-1 accent-brand-500"
                        />
                        <div className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[11px] font-mono text-zinc-200 min-w-[44px] text-center">
                          {duration}s
                        </div>
                      </div>
                    )}
                    {duration === -1 && (
                      <div className="text-[10px] text-zinc-500 bg-zinc-800/40 rounded px-2 py-1 leading-snug">
                        Seedance picks the duration automatically based on content.
                      </div>
                    )}
                  </div>

                  {/* Build quantity */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Build quantity</label>
                      <div className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[11px] font-mono text-zinc-200 min-w-[44px] text-center">
                        {videoCount} video{videoCount > 1 ? "s" : ""}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      value={videoCount}
                      onChange={(e) => setVideoCount(parseInt(e.target.value))}
                      className="w-full accent-brand-500"
                    />
                  </div>

                  {/* Output sound + Watermark toggles — matching playground order */}
                  <div className="space-y-1.5">
                    <SlimToggle label="Output sound"   checked={generateAudio} onChange={setGenerateAudio} />
                    <SlimToggle label="Watermark"      checked={watermark}     onChange={setWatermark}     />
                  </div>

                  {/* Random seed */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Random seed</label>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        value={seed}
                        onChange={(e) => {
                          const n = parseInt(e.target.value);
                          setSeed(Number.isFinite(n) ? n : -1);
                        }}
                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-brand-500 font-mono"
                      />
                      <button
                        onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))}
                        className="px-2 py-1 text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded-lg text-xs"
                        title="Randomize"
                      >🎲</button>
                      <button
                        onClick={() => setSeed(-1)}
                        className="px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded-lg"
                        title="Use -1 for random per generation"
                      >-1</button>
                    </div>
                  </div>

                  {/* Advanced parameter settings */}
                  <details className="group">
                    <summary className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider cursor-pointer list-none flex items-center justify-between">
                      <span>Advanced parameter settings</span>
                      <span className="text-zinc-600 group-open:rotate-180 transition">▾</span>
                    </summary>
                    <div className="pt-2 space-y-1.5">
                      <SlimToggle label="Fixed camera"      checked={cameraFixed}     onChange={setCameraFixed}     />
                      <SlimToggle label="Return last frame" checked={returnLastFrame} onChange={setReturnLastFrame} />
                      {returnLastFrame && (
                        <div className="text-[10px] text-zinc-500 bg-zinc-800/40 rounded p-1.5 leading-snug">
                          The final still is returned alongside the clip — useful as the first frame of a follow-up video.
                        </div>
                      )}
                      {cameraFixed && (
                        <div className="text-[10px] text-amber-400/80 bg-amber-500/5 rounded p-1.5 leading-snug">
                          Per BytePlus docs, <span className="font-medium">camera_fixed is currently not supported on Seedance 2.0 / 2.0 fast</span> — it may be ignored. Works reliably on Seedance 1.5 Pro.
                        </div>
                      )}
                    </div>
                  </details>
                </div>
              )}
            </div>
            {/* ── end Configure panel ── */}

            {/* Prompt + attached-reference chip bar (playground-style) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">Prompt</label>

              {/* Chip bar — one chip per attached reference. Click a chip to insert
                  the corresponding @mention at the current caret position. */}
              {mode === "ref" && (
                <ReferenceChipBar
                  refImages={refImageSlots.map((s, i) => ({
                    idx:   i,
                    src:   s.upload || s.url,
                    label: `image${i + 1}`,
                    mention: `[Image ${i + 1}]`,
                  })).filter((r) => !!r.src)}
                  refVideos={refVideoSlots.map((v, i) => ({
                    idx:   i,
                    src:   v,
                    label: `video${i + 1}`,
                    mention: `[Video ${i + 1}]`,
                  })).filter((r) => !!r.src)}
                  refAudios={refAudioSlots.map((a, i) => ({
                    idx:   i,
                    src:   a,
                    label: `audio${i + 1}`,
                    mention: `[Audio ${i + 1}]`,
                  })).filter((r) => !!r.src)}
                  onInsertMention={(mention) => insertAtPromptCaret(mention)}
                />
              )}

              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder={
                  mode === "ref"
                    ? 'Describe the video… click a chip above to insert [Image N] / [Video N] / [Audio N] at the cursor'
                    : 'Describe the transition from the first frame to the last frame…'
                }
                className="prompt-textarea w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500 resize-none"
              />
              <div className="flex justify-between items-center text-[10px] text-zinc-600">
                <div>
                  {estimate && (
                    <span className="font-mono text-amber-400/70">
                      ≈ ${estimate.cost_usd.toFixed(4)} / generation
                    </span>
                  )}
                </div>
                <div>{prompt.length} chars</div>
              </div>

              {/* Citation warning — per the official Seedance 2.0 docs, the
                  model ignores attached references unless the prompt cites
                  them as [Image n] / [Video n] / [Audio n]. This explains the
                  common "model isn't using my reference images" problem. */}
              {mode === "ref" && (() => {
                const attachedImg = refImageSlots.filter((s) => s.upload || s.url).length;
                const attachedVid = refVideoSlots.filter((v) => v && v.trim()).length;
                const attachedAud = refAudioSlots.filter((a) => a && a.trim()).length;
                if (attachedImg + attachedVid + attachedAud === 0) return null;
                const p = prompt || "";
                const citesImg = /\b(?:\[?\s*image\s*\d+\s*\]?|\(\s*image\s*\d+\s*\))/i.test(p);
                const citesVid = /\b(?:\[?\s*video\s*\d+\s*\]?|\(\s*video\s*\d+\s*\))/i.test(p);
                const citesAud = /\b(?:\[?\s*audio\s*\d+\s*\]?|\(\s*audio\s*\d+\s*\))/i.test(p);
                const missing = [];
                if (attachedImg > 0 && !citesImg) missing.push("[Image N]");
                if (attachedVid > 0 && !citesVid) missing.push("[Video N]");
                if (attachedAud > 0 && !citesAud) missing.push("[Audio N]");
                if (missing.length === 0) return null;
                return (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5 text-[10px] text-amber-200 leading-snug">
                    <span className="font-semibold">⚠ Missing citation in prompt.</span>{" "}
                    Seedance 2.0 only uses attached references when the prompt cites them.
                    Add <span className="font-mono text-amber-100">{missing.join(", ")}</span> inline
                    (click a chip above to insert, or use the prompt assistant).
                  </div>
                );
              })()}
            </div>

            {/* Prompt Assistant — placed directly under the prompt, where the
                user is most likely to want it. Reads ALL attached references so
                it can build the [Image n] / [Video n] / [Audio n] citation
                manifest required by Seedance 2.0. */}
            <PromptAssistant
              variant="20"
              mode={mode}
              onUsePrompt={setPrompt}
              images={{
                firstFrameUploadId,
                firstFrameUrl,
                lastFrameUploadId,
                lastFrameUrl,
                refImages,
                refVideos: refVideoSlots.map((v) => (v || "").trim()).filter(Boolean),
                refAudios: refAudioSlots.map((a) => (a || "").trim()).filter(Boolean),
              }}
            />

            {/* First + Last frame mode — side-by-side uploaders */}
            {mode === "i2v_fl" && (
              <div className="grid gap-3 grid-cols-2">
                <ImageUploader
                  label="First Frame"
                  uploadId={firstFrameUploadId}
                  imageUrl={firstFrameUrl}
                  onUploaded={setFirstFrameUploadId}
                  onUrlSet={setFirstFrameUrl}
                />
                <ImageUploader
                  label="Last Frame"
                  uploadId={lastFrameUploadId}
                  imageUrl={lastFrameUrl}
                  onUploaded={setLastFrameUploadId}
                  onUrlSet={setLastFrameUrl}
                />
              </div>
            )}

            {/* Reference mode — omni-reference (Seedance 2.0).
                Per official docs, in multimodal reference generation all
                images must use role:reference_image. First/last frame roles
                are NOT accepted here — cite "Image 1 as first frame" in the
                prompt instead. */}
            {mode === "ref" && (
              <div className="space-y-3">
                {/* Reference images — up to 9 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-300">
                      Reference Images <span className="text-zinc-500 font-normal">({refImageSlots.length}/9)</span>
                    </label>
                    <span className="text-[10px] text-zinc-500">cite as "Image 1" … "Image N"</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {refImageSlots.map((slot, i) => (
                      <div key={i} className="relative">
                        <ImageUploader
                          label={`Image ${i + 1}`}
                          uploadId={slot.upload}
                          imageUrl={slot.url}
                          onUploaded={(v) => updateRefImage(i, { upload: v })}
                          onUrlSet={(v) => updateRefImage(i, { url: v })}
                        />
                        <div className="flex gap-1 pl-1 mt-1">
                          <button
                            onClick={() => openAssetPicker((uri) => updateRefImage(i, { url: uri, upload: null }), "character")}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700"
                            title="Pick from BytePlus Library / Paste asset://"
                          >📁 Asset</button>
                        </div>
                        {refImageSlots.length > 1 && (
                          <button
                            onClick={() => removeRefImage(i)}
                            className="absolute top-0 right-0 text-[10px] text-zinc-500 hover:text-red-400 px-1"
                            title="Remove slot"
                          >✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  {refImageSlots.length < 9 && (
                    <button
                      onClick={addRefImage}
                      className="text-[10px] text-brand-400 hover:text-brand-300"
                    >+ Add image reference</button>
                  )}
                </div>

                {/* Reference videos — up to 3 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-300">
                      Reference Videos <span className="text-zinc-500 font-normal">({refVideoSlots.length}/3)</span>
                    </label>
                    <span className="text-[10px] text-zinc-500">total ≤15s · cite as "Video N"</span>
                  </div>
                  {refVideoSlots.map((v, i) => {
                    const depthSt = controlState[`depth-${i}`] || {};
                    const poseSt  = controlState[`pose-${i}`]  || {};
                    const renderControlResult = (st, type, color, title) => {
                      if (!st.done) return null;
                      const colorMap = {
                        purple: { bg: "bg-purple-400/5", border: "border-purple-500/30", text: "text-purple-300", thumb: "border-purple-500/40 hover:border-purple-400" },
                        teal:   { bg: "bg-teal-400/5",   border: "border-teal-500/30",   text: "text-teal-300",   thumb: "border-teal-500/40 hover:border-teal-400"   },
                      };
                      const c = colorMap[color];
                      return (
                        <div key={`${type}-result`} className={`ml-1 flex gap-2 ${c.bg} border ${c.border} rounded-lg p-2 relative`}>
                          {/* × — discard just this mapping (leave the source video alone) */}
                          <button
                            onClick={() => clearControlResult(type, i)}
                            className="absolute top-1 right-1.5 text-zinc-500 hover:text-red-400 text-xs leading-none w-4 h-4 flex items-center justify-center"
                            title={`Discard this ${title.toLowerCase()}`}
                          >✕</button>
                          {st.url && (
                            <button
                              onClick={() => setVideoPopup({ src: st.url, title: `${title} · Video ${i + 1}` })}
                              className={`relative w-16 h-16 rounded-md overflow-hidden border ${c.thumb} transition flex-shrink-0 group bg-black`}
                              title="Click to preview"
                            >
                              {/* preload="none" — see useAfterEffects.js: each
                                  parent re-render was forcing Chromium to
                                  refetch video metadata on these thumbnails,
                                  visually flickering the depth/pose preview. */}
                              <video
                                src={st.url}
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
                          )}
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className={`text-[10px] ${c.text}`}>
                              ✓ {title} ready — applied to Video {i + 1}
                            </div>
                            {st.localPath && (
                              <div className="text-[9px] text-zinc-500 font-mono truncate" title={st.localPath}>
                                {st.localPath.split(/[\\/]/).pop()}
                              </div>
                            )}
                            {isAE && st.localPath && (
                              <button
                                onClick={() => importControlToAE(type, i)}
                                disabled={st.aeStatus === "importing"}
                                className="w-full text-[10px] px-2 py-1 rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 border border-blue-500/30 disabled:opacity-50"
                              >
                                {st.aeStatus === "importing" ? "Importing…" : "↗ Add to AE timeline"}
                              </button>
                            )}
                            {st.aeStatus && st.aeStatus !== "importing" && (
                              <div className={`text-[10px] ${st.aeStatus.startsWith("Error") ? "text-red-400" : "text-blue-400"}`}>
                                {st.aeStatus}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    };

                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-start gap-1">
                          <div className="flex-1">
                            <VideoUploader
                              label={`Video ${i + 1}`}
                              hint={`— cite as "Video ${i + 1}"`}
                              value={v}
                              onChange={(val) => updateRefVideo(i, val)}
                            />
                          </div>
                          {refVideoSlots.length > 1 && (
                            <button
                              onClick={() => removeRefVideo(i)}
                              className="text-[10px] text-zinc-500 hover:text-red-400 mt-4 px-1"
                              title="Remove slot"
                            >✕</button>
                          )}
                        </div>

                        {/* Tools row: asset helper + controlnet preprocessors */}
                        <div className="flex flex-wrap gap-1 pl-1">
                          <button
                            onClick={() => openAssetPicker((uri) => updateRefVideo(i, uri), "video")}
                            className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700"
                            title="Browse BytePlus assets — My Library, recent generations, or paste an asset:// ID"
                          >📁 Asset…</button>
                          <button
                            onClick={() => runControl("depth", i, v)}
                            disabled={depthSt.busy || !v || !v.startsWith("http")}
                            className="text-[10px] px-2 py-0.5 rounded bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 border border-purple-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Depth Anything preprocessor via fal.ai — bypasses real-person block, structure-only guidance"
                          >
                            {depthSt.busy ? "Generating depth…" : "↯ Depth map"}
                          </button>
                          <button
                            onClick={() => runControl("pose", i, v)}
                            disabled={poseSt.busy || !v || !v.startsWith("http")}
                            className="text-[10px] px-2 py-0.5 rounded bg-teal-600/20 text-teal-300 hover:bg-teal-600/30 border border-teal-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="DWPose (OpenPose-style) preprocessor via fal.ai — body skeleton guidance, bypasses real-person block"
                          >
                            {poseSt.busy ? "Generating pose…" : "◉ Pose"}
                          </button>
                        </div>

                        {depthSt.busy && depthSt.stage && (
                          <div className="text-[10px] text-purple-300 bg-purple-400/10 rounded p-1.5 ml-1 flex items-center gap-1.5">
                            <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full spin-slow" />
                            Depth: {depthSt.stage.replace(/_/g, " ")}…
                          </div>
                        )}
                        {depthSt.error && (
                          <div className="text-[10px] text-red-400 bg-red-400/10 rounded p-1.5 ml-1 break-all">{depthSt.error}</div>
                        )}
                        {renderControlResult(depthSt, "depth", "purple", "Depth map")}

                        {poseSt.busy && poseSt.stage && (
                          <div className="text-[10px] text-teal-300 bg-teal-400/10 rounded p-1.5 ml-1 flex items-center gap-1.5">
                            <div className="w-3 h-3 border-2 border-teal-400 border-t-transparent rounded-full spin-slow" />
                            Pose: {poseSt.stage.replace(/_/g, " ")}…
                          </div>
                        )}
                        {poseSt.error && (
                          <div className="text-[10px] text-red-400 bg-red-400/10 rounded p-1.5 ml-1 break-all">{poseSt.error}</div>
                        )}
                        {renderControlResult(poseSt, "pose", "teal", "Pose skeleton")}
                      </div>
                    );
                  })}
                  {refVideoSlots.length < 3 && (
                    <button onClick={addRefVideo} className="text-[10px] text-brand-400 hover:text-brand-300">
                      + Add video reference
                    </button>
                  )}
                </div>

                {/* Reference audios — up to 3 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-300">
                      Reference Audios <span className="text-zinc-500 font-normal">({refAudioSlots.length}/3)</span>
                    </label>
                    <span className="text-[10px] text-zinc-500">total ≤15s · cite as "Audio N"</span>
                  </div>
                  {refAudioSlots.map((a, i) => (
                    <div key={i} className="flex items-start gap-1">
                      <div className="flex-1">
                        <AudioUploader
                          label={`Audio ${i + 1}`}
                          hint={`— cite as "Audio ${i + 1}"`}
                          value={a}
                          onChange={(val) => updateRefAudio(i, val)}
                        />
                        <div className="flex gap-1 pl-1 mt-1">
                          <button
                            onClick={() => openAssetPicker((uri) => updateRefAudio(i, uri), "audio")}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700"
                            title="Pick from BytePlus Library / Paste asset://"
                          >📁 Asset</button>
                        </div>
                      </div>
                      {refAudioSlots.length > 1 && (
                        <button
                          onClick={() => removeRefAudio(i)}
                          className="text-[10px] text-zinc-500 hover:text-red-400 mt-4 px-1"
                          title="Remove"
                        >✕</button>
                      )}
                    </div>
                  ))}
                  {refAudioSlots.length < 3 && (
                    <button onClick={addRefAudio} className="text-[10px] text-brand-400 hover:text-brand-300">
                      + Add audio reference
                    </button>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => openAssetPicker((uri) => {
                      const idx = refVideoSlots.findIndex((v) => !v);
                      if (idx >= 0) updateRefVideo(idx, uri);
                      else addRefVideo();
                    }, "video")}
                    className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 hover:border-brand-500 rounded-lg text-xs text-zinc-300 hover:text-white transition flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    Browse BytePlus Assets (Library · Recent · Paste)
                  </button>
                </div>

                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-[10px] text-amber-400 space-y-1">
                  <div className="font-medium">⚠ Content policy — real-person restrictions</div>
                  <div className="text-amber-300/90">
                    BytePlus rejects references containing real human faces unless they are registered via the BytePlus console
                    (<span className="font-mono">asset://&lt;id&gt;</span>). For video references use one of:
                  </div>
                  <ul className="text-zinc-400 ml-3 list-disc space-y-0.5">
                    <li>A public HTTPS URL (your own TOS/S3/CDN hosting, public-read)</li>
                    <li><span className="font-mono">asset://&lt;id&gt;</span> from the Digital Character Library or your registered real-person assets</li>
                    <li>A Seedance-generated video from your account (last 24 h, URL from task result)</li>
                  </ul>
                </div>
              </div>
            )}

            </div>{/* end left column */}

            {/* ── RIGHT column: action + status (sticky on lg+) ── */}
            <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start lg:max-h-[calc(100vh-90px)] lg:overflow-y-auto lg:pr-1">

              {/* Generate button */}
              <button
                onClick={handleGenerate}
                disabled={generating || !prompt.trim()}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition ${
                  generating || !prompt.trim()
                    ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                    : "bg-brand-600 text-white hover:bg-brand-700 pulse-glow"
                }`}
              >
                {generating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full spin-slow" />
                    Creating task...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Generate Video
                    {estimate && (
                      <span className="text-xs opacity-70 font-mono">
                        ≈ ${estimate.cost_usd?.toFixed(4)}
                      </span>
                    )}
                  </span>
                )}
              </button>

              {genError && (
                <div className="bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-300">
                  {genError}
                </div>
              )}

              {activeTasks.length > 0 && (
                <div className="space-y-2">
                  {activeTasks.length > 1 && (
                    <div className="text-[10px] text-zinc-400">
                      {activeTasks.length} videos generating in parallel
                    </div>
                  )}
                  {activeTasks.map((tid) => (
                    <TaskStatus
                      key={tid}
                      taskId={tid}
                      onComplete={handleTaskComplete}
                      onOpenAssetHelper={openAssetHelperInfo}
                      onOpenPreview={setVideoPopup}
                    />
                  ))}
                </div>
              )}

              <CostEstimator estimate={estimate} loading={false} />
              <SpendingTracker totalSpent={totalSpent} taskCount={history.length} />

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                <h3 className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-2">
                  Seedance 2.0 Pricing
                </h3>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between text-zinc-400">
                    <span>Standard model</span>
                    <span className="font-mono text-zinc-300">$7.00/M tok</span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Fast model</span>
                    <span className="font-mono text-zinc-300">$5.60/M tok</span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>With video input</span>
                    <span className="font-mono text-zinc-300">$4.30 / $3.30/M</span>
                  </div>
                  <div className="flex justify-between text-zinc-500 text-[10px] mt-1">
                    <span>Formula</span>
                    <span className="font-mono">(W×H×24×dur)/1024</span>
                  </div>
                </div>
              </div>

              {history.length > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Recent</h3>
                    <button
                      onClick={() => setTab("history")}
                      className="text-[10px] text-brand-400 hover:text-brand-300"
                    >View all →</button>
                  </div>
                  <History
                    items={history.slice(0, 3)}
                    onRestore={restoreFromHistory}
                    onOpenPreview={setVideoPopup}
                  />
                </div>
              )}
            </aside>
          </div>{/* end grid */}
        </div>{/* end video tab */}

        {/* ── SEEDANCE 1.5 PRO TAB ── */}
        <div style={{ display: tab === "video15" ? "block" : "none" }}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-4 min-w-0">
              <div className="bg-zinc-800/40 border border-zinc-700 rounded-xl p-3 text-[11px] text-zinc-400">
                <div className="text-zinc-200 font-medium mb-1">Seedance 1.5 Pro</div>
                Legacy model (<span className="font-mono">seedance-1-5-pro-251215</span>). Supports 1080p and
                native audio sync, but <span className="text-amber-300">does not</span> support omni-reference
                (reference images / videos / audios). Use the <span className="text-brand-300">Video 2.0</span> tab
                for multi-modal references.
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: "t2v", label: "Text → Video" },
                  { id: "i2v", label: "First frame" },
                  { id: "flf", label: "First + Last" },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setV15Mode(m.id)}
                    className={`p-2.5 rounded-xl border text-xs font-medium transition ${
                      v15Mode === m.id
                        ? "border-brand-500 bg-brand-500/10 text-brand-300"
                        : "border-zinc-700 hover:border-zinc-600 bg-zinc-800/30 text-zinc-300"
                    }`}
                  >{m.label}</button>
                ))}
              </div>

              {(v15Mode === "i2v" || v15Mode === "flf") && (
                <div className={`grid gap-3 ${v15Mode === "flf" ? "grid-cols-2" : "grid-cols-1"}`}>
                  <ImageUploader
                    label="First Frame"
                    uploadId={v15FirstUpload}
                    imageUrl={v15FirstUrl}
                    onUploaded={setV15FirstUpload}
                    onUrlSet={setV15FirstUrl}
                  />
                  {v15Mode === "flf" && (
                    <ImageUploader
                      label="Last Frame"
                      uploadId={v15LastUpload}
                      imageUrl={v15LastUrl}
                      onUploaded={setV15LastUpload}
                      onUrlSet={setV15LastUrl}
                    />
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">Prompt</label>
                <textarea
                  value={v15Prompt}
                  onChange={(e) => setV15Prompt(e.target.value)}
                  rows={3}
                  placeholder="Describe the video (no reference assets in 1.5 Pro)…"
                  className="prompt-textarea w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500 resize-none"
                />
              </div>

              {/* Prompt Assistant — tuned to the Seedance 1.5 Pro prompt guide
                  (no slot citations, native audio, Subject + Movement + Camera
                  + Aesthetic + Sound formula). */}
              <PromptAssistant
                variant="15"
                mode={v15Mode}
                onUsePrompt={setV15Prompt}
                images={{
                  firstFrameUploadId: v15FirstUpload,
                  firstFrameUrl:      v15FirstUrl,
                  lastFrameUploadId:  v15LastUpload,
                  lastFrameUrl:       v15LastUrl,
                }}
              />

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-zinc-400">Resolution</label>
                  <select
                    value={v15Resolution}
                    onChange={(e) => setV15Resolution(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
                  >
                    {SEEDANCE_1_5_PRO_RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-zinc-400">Aspect Ratio</label>
                  <select
                    value={v15Ratio}
                    onChange={(e) => setV15Ratio(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
                  >
                    {SEEDANCE_1_5_PRO_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-zinc-400">Duration: {v15Duration}s</label>
                  <input
                    type="range"
                    min={4}
                    max={12}
                    value={v15Duration}
                    onChange={(e) => setV15Duration(parseInt(e.target.value))}
                    className="w-full accent-brand-500 mt-1"
                  />
                  <div className="flex justify-between text-[9px] text-zinc-600">
                    <span>4s</span><span>12s</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Toggle label="Audio" description="Native audio" checked={v15Audio} onChange={setV15Audio} />
                <Toggle label="Fixed camera" description="Lock camera" checked={v15CameraFixed} onChange={setV15CameraFixed} />
                <Toggle label="Watermark" description="AI-gen overlay" checked={v15Watermark} onChange={setV15Watermark} />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-medium text-zinc-400">Seed <span className="text-zinc-600">(-1 random)</span></label>
                <input
                  type="number"
                  value={v15Seed}
                  onChange={(e) => {
                    const n = parseInt(e.target.value);
                    setV15Seed(Number.isFinite(n) ? n : -1);
                  }}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500 font-mono"
                />
              </div>
            </div>

            <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start lg:max-h-[calc(100vh-90px)] lg:overflow-y-auto lg:pr-1">
              <button
                onClick={runV15Generate}
                disabled={v15Generating || !v15Prompt.trim() || ((v15Mode === "i2v" || v15Mode === "flf") && !v15FirstUpload && !v15FirstUrl) || (v15Mode === "flf" && !v15LastUpload && !v15LastUrl)}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition ${
                  v15Generating || !v15Prompt.trim()
                    ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                    : "bg-brand-600 text-white hover:bg-brand-700"
                }`}
              >
                {v15Generating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full spin-slow" />
                    Creating task…
                  </span>
                ) : "Generate Video (1.5 Pro)"}
              </button>

              {v15Error && (
                <div className="bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-300">{v15Error}</div>
              )}

              {v15ActiveTasks.length > 0 && (
                <div className="space-y-2">
                  {v15ActiveTasks.map((tid) => (
                    <TaskStatus
                      key={tid}
                      taskId={tid}
                      onComplete={handleTaskComplete}
                      onOpenAssetHelper={openAssetHelperInfo}
                      onOpenPreview={setVideoPopup}
                    />
                  ))}
                </div>
              )}

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-[11px] text-zinc-400 leading-snug">
                <div className="text-zinc-300 font-medium mb-1">Seedance 1.5 Pro vs 2.0</div>
                <ul className="space-y-1 list-disc ml-4">
                  <li><span className="text-zinc-200">1.5 Pro</span> — up to 1080p, t2v / i2v / flf only</li>
                  <li><span className="text-zinc-200">2.0</span> — 480p/720p, adds omni-reference (images, videos, audios)</li>
                </ul>
              </div>
            </aside>
          </div>
        </div>

        {/* ── HAPPYHORSE TAB (Alibaba Cloud Model Studio) ── */}
        <div style={{ display: tab === "happyhorse" ? "block" : "none" }}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* LEFT column */}
            <div className="space-y-4 min-w-0">

              {/* Info banner */}
              <div className="bg-zinc-800/40 border border-zinc-700 rounded-xl p-3 text-[11px] text-zinc-400 leading-snug">
                <div className="text-zinc-200 font-medium mb-1">🐎 HappyHorse 1.0 (Alibaba Cloud)</div>
                Async DashScope API (1-5 minutes per generation). All inputs require public HTTPS URLs;
                local files are auto-uploaded to tmpfiles.org for ~60 minutes. Configure your Alibaba
                Cloud key + region in <span className="text-zinc-300">Settings</span>.
              </div>

              {/* Mode selector — 4 sub-models */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {[
                  { id: "t2v",  label: "Text → Video",   desc: "happyhorse-1.0-t2v" },
                  { id: "i2v",  label: "First Frame",    desc: "happyhorse-1.0-i2v" },
                  { id: "r2v",  label: "References",     desc: "happyhorse-1.0-r2v" },
                  { id: "edit", label: "Video Edit",     desc: "happyhorse-1.0-video-edit" },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setHhMode(m.id)}
                    title={m.desc}
                    className={`p-2.5 rounded-xl border text-left transition ${
                      hhMode === m.id
                        ? "border-brand-500 bg-brand-500/10"
                        : "border-zinc-700 hover:border-zinc-600 bg-zinc-800/30"
                    }`}
                  >
                    <div className={`text-xs font-medium ${hhMode === m.id ? "text-brand-300" : "text-zinc-300"}`}>
                      {m.label}
                    </div>
                    <div className="text-[9px] text-zinc-500 mt-0.5 font-mono">{m.desc}</div>
                  </button>
                ))}
              </div>

              {/* Mode-specific inputs */}
              {hhMode === "i2v" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">First Frame</label>
                  <ImageUploader
                    label=""
                    uploadId={hhFirstFrame.startsWith("data:") ? hhFirstFrame : null}
                    imageUrl={hhFirstFrame.startsWith("http") ? hhFirstFrame : ""}
                    onUploaded={(v) => setHhFirstFrame(v || "")}
                    onUrlSet={(v) => setHhFirstFrame(v || "")}
                  />
                  <div className="text-[10px] text-zinc-500 leading-snug">
                    Output aspect ratio auto-follows this image. JPEG/PNG/WEBP, ≥300px each side, ≤10MB.
                  </div>
                </div>
              )}

              {hhMode === "r2v" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-300">
                      Reference Images <span className="text-zinc-500 font-normal">({hhRefSlots.length}/9)</span>
                    </label>
                    <span className="text-[10px] text-zinc-500">cite as [Image 1]…[Image N] in the prompt</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {hhRefSlots.map((slot, i) => (
                      <div key={i} className="relative">
                        <ImageUploader
                          label={`[Image ${i + 1}]`}
                          uploadId={slot.upload}
                          imageUrl={slot.url}
                          onUploaded={(v) => updateHhRef(i, { upload: v })}
                          onUrlSet={(v) => updateHhRef(i, { url: v })}
                        />
                        {hhRefSlots.length > 1 && (
                          <button
                            onClick={() => removeHhRef(i)}
                            className="absolute top-0 right-0 text-[10px] text-zinc-500 hover:text-red-400 px-1"
                            title="Remove slot"
                          >✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  {hhRefSlots.length < 9 && (
                    <button onClick={addHhRef} className="text-[10px] text-brand-400 hover:text-brand-300">
                      + Add image reference
                    </button>
                  )}
                  <div className="text-[10px] text-zinc-500 bg-zinc-800/30 rounded p-2 leading-snug">
                    <span className="text-zinc-300 font-medium">Citation rule (docs):</span> the prompt MUST cite each
                    image as <span className="font-mono">[Image n]</span> paired with a subject description, e.g.
                    "<span className="text-zinc-300">the woman in red qipao in [Image 1]</span>".
                  </div>
                </div>
              )}

              {hhMode === "edit" && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-300">Input Video URL</label>
                    <input
                      type="url"
                      value={hhEditVideo}
                      onChange={(e) => setHhEditVideo(e.target.value)}
                      placeholder="https://… (MP4/MOV, 3-60s, ≤100MB, ≥320px short side)"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500"
                    />
                    <div className="text-[10px] text-zinc-500 leading-snug">
                      Output is capped at 15s; longer inputs use only the first 15s.
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-zinc-300">
                        Reference Images <span className="text-zinc-500 font-normal">({hhEditRefSlots.length}/5, optional)</span>
                      </label>
                    </div>
                    {hhEditRefSlots.length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        {hhEditRefSlots.map((slot, i) => (
                          <div key={i} className="relative">
                            <ImageUploader
                              label={`Ref ${i + 1}`}
                              uploadId={slot.upload}
                              imageUrl={slot.url}
                              onUploaded={(v) => updateHhEditRef(i, { upload: v })}
                              onUrlSet={(v) => updateHhEditRef(i, { url: v })}
                            />
                            <button
                              onClick={() => removeHhEditRef(i)}
                              className="absolute top-0 right-0 text-[10px] text-zinc-500 hover:text-red-400 px-1"
                              title="Remove slot"
                            >✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {hhEditRefSlots.length < 5 && (
                      <button onClick={addHhEditRef} className="text-[10px] text-brand-400 hover:text-brand-300">
                        + Add reference image
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Prompt + Prompt Assistant */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">
                  Prompt {hhMode === "i2v" && <span className="text-zinc-500 font-normal">(optional in i2v mode)</span>}
                </label>
                <textarea
                  value={hhPrompt}
                  onChange={(e) => setHhPrompt(e.target.value)}
                  rows={4}
                  placeholder={
                    hhMode === "r2v" ? 'Describe the scene, citing [Image 1]…[Image N] with subject phrases'
                    : hhMode === "edit" ? 'Describe the edit (e.g. "Make the character in the video wear the striped sweater from the image")'
                    : hhMode === "i2v" ? 'Optional: describe motion that begins from the image'
                    : 'Describe the video to generate'
                  }
                  className="prompt-textarea w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500 resize-none"
                />
                <div className="text-[10px] text-zinc-600 text-right">{hhPrompt.length} / 5000 chars</div>
              </div>

              <PromptAssistant
                variant="hh"
                mode={hhMode}
                onUsePrompt={setHhPrompt}
                images={{
                  firstFrame: hhMode === "i2v" ? hhFirstFrame : null,
                  refImages:  hhMode === "r2v"
                    ? hhRefSlots.map((s) => s.upload || s.url).filter(Boolean)
                    : hhMode === "edit"
                      ? hhEditRefSlots.map((s) => s.upload || s.url).filter(Boolean)
                      : [],
                  editVideo:  hhMode === "edit" ? hhEditVideo : null,
                }}
              />
            </div>

            {/* RIGHT column — Configure + action + result */}
            <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start lg:max-h-[calc(100vh-90px)] lg:overflow-y-auto lg:pr-1">

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-3">
                <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">Configure</h3>

                {/* Resolution */}
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Resolution</label>
                  <div className="grid grid-cols-2 gap-1">
                    {HAPPYHORSE_RESOLUTIONS.map((r) => (
                      <button
                        key={r}
                        onClick={() => setHhResolution(r)}
                        className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition border ${
                          hhResolution === r
                            ? "border-brand-500 bg-brand-500/10 text-brand-300"
                            : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                        }`}
                      >{r}</button>
                    ))}
                  </div>
                </div>

                {/* Ratio — only t2v/r2v */}
                {(hhMode === "t2v" || hhMode === "r2v") && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Ratio</label>
                    <div className="grid grid-cols-3 gap-1">
                      {HAPPYHORSE_RATIOS.map((r) => (
                        <button
                          key={r}
                          onClick={() => setHhRatio(r)}
                          className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition border ${
                            hhRatio === r
                              ? "border-brand-500 bg-brand-500/10 text-brand-300"
                              : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                          }`}
                        >{r}</button>
                      ))}
                    </div>
                  </div>
                )}
                {hhMode === "i2v" && (
                  <div className="text-[10px] text-zinc-500 bg-zinc-800/40 rounded px-2 py-1 leading-snug">
                    Aspect ratio auto-follows the input image (per docs).
                  </div>
                )}

                {/* Duration — except edit */}
                {hhMode !== "edit" && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Duration</label>
                      <div className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[11px] font-mono text-zinc-200 min-w-[44px] text-center">
                        {hhDuration}s
                      </div>
                    </div>
                    <input
                      type="range"
                      min={3} max={15}
                      value={hhDuration}
                      onChange={(e) => setHhDuration(parseInt(e.target.value))}
                      className="w-full accent-brand-500"
                    />
                    <div className="flex justify-between text-[9px] text-zinc-600">
                      <span>3s</span><span>15s</span>
                    </div>
                  </div>
                )}
                {hhMode === "edit" && (
                  <div className="text-[10px] text-zinc-500 bg-zinc-800/40 rounded px-2 py-1 leading-snug">
                    Output duration follows the input video (capped at 15s).
                  </div>
                )}

                {/* audio_setting — edit only */}
                {hhMode === "edit" && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Audio</label>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { id: "auto",   label: "Auto (model)" },
                        { id: "origin", label: "Keep original" },
                      ].map((a) => (
                        <button
                          key={a.id}
                          onClick={() => setHhAudioSetting(a.id)}
                          className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition border ${
                            hhAudioSetting === a.id
                              ? "border-brand-500 bg-brand-500/10 text-brand-300"
                              : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                          }`}
                        >{a.label}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Watermark + seed */}
                <SlimToggle label="Watermark" checked={hhWatermark} onChange={setHhWatermark} />

                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Random seed</label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      value={hhSeed}
                      onChange={(e) => {
                        const n = parseInt(e.target.value);
                        setHhSeed(Number.isFinite(n) ? n : -1);
                      }}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-brand-500 font-mono"
                    />
                    <button
                      onClick={() => setHhSeed(Math.floor(Math.random() * 2_147_483_647))}
                      className="px-2 py-1 text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded-lg text-xs"
                      title="Randomize"
                    >🎲</button>
                    <button
                      onClick={() => setHhSeed(-1)}
                      className="px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded-lg"
                      title="-1 = random per generation"
                    >-1</button>
                  </div>
                </div>
              </div>

              <button
                onClick={runHhGenerate}
                disabled={hhBusy || (!hhPrompt.trim() && hhMode !== "i2v")}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition ${
                  hhBusy || (!hhPrompt.trim() && hhMode !== "i2v")
                    ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                    : "bg-brand-600 text-white hover:bg-brand-700"
                }`}
              >
                {hhBusy ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full spin-slow" />
                    Generating…
                  </span>
                ) : `Generate (${HAPPYHORSE_MODELS[hhMode]})`}
              </button>

              {hhStage && (
                <div className="text-[10px] text-brand-300 bg-brand-500/5 rounded px-2 py-1 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 border-[1.5px] border-brand-400 border-t-transparent rounded-full spin-slow flex-shrink-0" />
                  {hhStage}
                </div>
              )}

              {hhError && (
                <div className="bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-300 break-all">
                  {hhError}
                </div>
              )}

              {hhResult && hhResult.video_url && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
                  <button
                    onClick={() => setVideoPopup({ src: hhResult.video_url, title: "HappyHorse output" })}
                    className="relative w-full aspect-video rounded-md overflow-hidden border border-zinc-700 hover:border-brand-500 transition bg-black flex items-center justify-center group"
                  >
                    <video
                      src={hhResult.video_url}
                      muted playsInline preload="none"
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/10 transition">
                      <svg className="w-8 h-8 text-white drop-shadow" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </button>
                  <div className="text-[10px] text-zinc-500 font-mono break-all">
                    Task: {hhResult.task_id}
                  </div>
                  {hhLocalPath && (
                    <div className="text-[10px] text-emerald-400 break-all">✓ Saved: {hhLocalPath}</div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {isAE && hhLocalPath && (
                      <button
                        onClick={importHhToAE}
                        disabled={hhAeStatus === "importing"}
                        className="px-2 py-1.5 rounded-lg bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 border border-blue-500/30 text-[11px] disabled:opacity-50"
                      >
                        {hhAeStatus === "importing" ? "Importing…" : "↗ Add to AE"}
                      </button>
                    )}
                    <a
                      href={hhResult.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-[11px] text-center"
                    >🔗 Open URL</a>
                  </div>
                  {hhAeStatus && hhAeStatus !== "importing" && (
                    <div className={`text-[10px] ${hhAeStatus.startsWith("Error") ? "text-red-400" : "text-blue-400"}`}>
                      {hhAeStatus}
                    </div>
                  )}
                  <div className="text-[9px] text-zinc-500 leading-snug pt-1 border-t border-zinc-800">
                    ⚠ Output URL valid for 24 h per docs. Already auto-saved to your project folder above.
                  </div>
                </div>
              )}

              {/* Quick reference */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-[10px] text-zinc-500 leading-snug">
                <div className="text-zinc-300 font-medium mb-1">HappyHorse 1.0 (Alibaba)</div>
                <ul className="space-y-0.5 ml-3 list-disc">
                  <li>Async API, 1-5 min per task</li>
                  <li>Inputs: public HTTPS URLs only (auto-uploaded)</li>
                  <li>Output URL valid 24h — saved locally</li>
                  <li>Resolution 720P / 1080P · ratios 16:9 / 9:16 / 1:1 / 4:3 / 3:4</li>
                </ul>
              </div>
            </aside>
          </div>
        </div>

        {/* ── IMAGE TAB ── */}
        <div style={{ display: tab === "image" ? "block" : "none" }}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* LEFT — controls */}
            <div className="space-y-3 min-w-0">
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: "t2i", label: "Text → Image",  desc: "Generate from prompt" },
                  { id: "i2i", label: "Edit Image",    desc: "Modify input image" },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setImgMode(m.id)}
                    className={`p-2.5 rounded-xl border text-left transition ${
                      imgMode === m.id
                        ? "border-brand-500 bg-brand-500/10"
                        : "border-zinc-700 hover:border-zinc-600 bg-zinc-800/30"
                    }`}
                  >
                    <div className={`text-xs font-medium ${imgMode === m.id ? "text-brand-300" : "text-zinc-300"}`}>
                      {m.label}
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{m.desc}</div>
                  </button>
                ))}
              </div>

              {imgMode === "i2i" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">Input image</label>
                  <div
                    onClick={() => imgFileRef.current?.click()}
                    onDrop={(e) => { e.preventDefault(); handleImgFileDrop(e.dataTransfer?.files?.[0]); }}
                    onDragOver={(e) => e.preventDefault()}
                    className="border-2 border-dashed border-zinc-700 hover:border-brand-500 rounded-xl p-4 cursor-pointer transition"
                  >
                    {imgInput ? (
                      <div className="flex items-center gap-3">
                        <img src={imgInput} alt="" className="w-16 h-16 object-cover rounded-md flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-emerald-400 truncate">{imgInputName || "Loaded"}</div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setImgInput(""); setImgInputName(""); }}
                            className="text-[10px] text-zinc-500 hover:text-red-400"
                          >Remove</button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-xs text-zinc-500">
                        Drop an image or click to browse
                      </div>
                    )}
                    <input
                      ref={imgFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleImgFileDrop(e.target.files?.[0])}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">Prompt</label>
                <textarea
                  value={imgPrompt}
                  onChange={(e) => setImgPrompt(e.target.value)}
                  rows={4}
                  placeholder={imgMode === "i2i"
                    ? "Describe the edit to apply (e.g. 'change the sky to a stormy sunset, keep the subject identical')"
                    : "Describe the image you want to generate..."}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500 resize-none"
                />
                <div className="text-[10px] text-zinc-600 text-right">{imgPrompt.length} chars</div>
              </div>

              {imgMode === "t2i" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-zinc-400">Size / Aspect</label>
                    <select
                      value={imgSize}
                      onChange={(e) => setImgSize(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
                    >
                      {SEEDREAM_T2I_SIZES.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-zinc-400">Seed (-1 random)</label>
                    <input
                      type="number"
                      value={imgSeed}
                      onChange={(e) => {
                        const n = parseInt(e.target.value);
                        setImgSeed(Number.isFinite(n) ? n : -1);
                      }}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500 font-mono"
                    />
                  </div>
                </div>
              )}

              <button
                onClick={runImageGenerate}
                disabled={imgGenerating || !imgPrompt.trim() || (imgMode === "i2i" && !imgInput)}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition ${
                  imgGenerating || !imgPrompt.trim() || (imgMode === "i2i" && !imgInput)
                    ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                    : "bg-brand-600 text-white hover:bg-brand-700"
                }`}
              >
                {imgGenerating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full spin-slow" />
                    {imgMode === "i2i" ? "Editing image…" : "Generating image…"}
                  </span>
                ) : imgMode === "i2i" ? "Apply edit (Seedream 5.0)" : "Generate image (Seedream 3.0)"}
              </button>

              {imgError && (
                <div className="bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-300">
                  {imgError}
                </div>
              )}

              <div className="text-[10px] text-zinc-500 bg-zinc-800/40 rounded-lg px-3 py-2 leading-snug">
                <span className="text-zinc-400 font-medium">Models:</span> t2i uses{" "}
                <span className="font-mono">doubao-seedream-3-0-t2i-250415</span>; image-edit uses{" "}
                <span className="font-mono">seedream-5-0-260128</span>. Both billed via your BytePlus ARK key —
                see the BytePlus pricing page for current per-image rates.
              </div>
            </div>

            {/* RIGHT — preview + actions */}
            <div className="space-y-3 min-w-0">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 min-h-[300px] flex items-center justify-center">
                {imgGenerating ? (
                  <div className="text-center text-zinc-500 text-xs space-y-2">
                    <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full spin-slow mx-auto" />
                    <div>Generating…</div>
                  </div>
                ) : imgResult ? (
                  <button
                    onClick={() => setVideoPopup({ src: imgResult, title: "Generated image", isImage: true })}
                    className="block w-full"
                    title="Click to enlarge"
                  >
                    <img src={imgResult} alt="" className="w-full h-auto max-h-[60vh] object-contain rounded-lg" />
                  </button>
                ) : (
                  <div className="text-center text-zinc-600 text-xs">
                    <div className="text-3xl mb-2">🖼</div>
                    <div>Result will appear here</div>
                  </div>
                )}
              </div>

              {imgResult && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={importImageToAE}
                    disabled={!isAE || !imgResultPath || imgAeStatus === "importing"}
                    className="px-3 py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {imgAeStatus === "importing" ? "Importing…" : "↗ Add to AE timeline"}
                  </button>
                  <button
                    onClick={openImgInPhotoshop}
                    disabled={!imgResultPath || imgPsStatus === "opening"}
                    className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {imgPsStatus === "opening" ? "Opening…" : "🎨 Open in Photoshop"}
                  </button>
                  <button
                    onClick={useImgAsRef}
                    className="col-span-2 px-3 py-2 rounded-lg bg-brand-600/20 hover:bg-brand-600/30 border border-brand-500/30 text-brand-300 text-xs"
                  >
                    ⤴ Use as Reference Image (switch to Video tab)
                  </button>
                </div>
              )}

              {(imgAeStatus && imgAeStatus !== "importing") && (
                <div className={`text-[10px] rounded p-2 ${imgAeStatus.startsWith("Error") ? "text-red-400 bg-red-400/10" : "text-blue-400 bg-blue-400/10"}`}>
                  {imgAeStatus}
                </div>
              )}
              {(imgPsStatus && imgPsStatus !== "opening") && (
                <div className={`text-[10px] rounded p-2 ${imgPsStatus.startsWith("Error") ? "text-red-400 bg-red-400/10" : "text-emerald-400 bg-emerald-400/10"}`}>
                  {imgPsStatus}
                </div>
              )}
              {imgResultPath && (
                <div className="text-[10px] text-zinc-500 font-mono truncate" title={imgResultPath}>
                  Saved: {imgResultPath}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── HISTORY TAB ── */}
        <div style={{ display: tab === "history" ? "block" : "none" }}>
          <div className="space-y-3 max-w-3xl mx-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-200">Session history</h2>
              <SpendingTracker totalSpent={totalSpent} taskCount={history.length} />
            </div>
            {history.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500 text-xs">
                No generations yet. Start one from the Video or Image tab.
              </div>
            ) : (
              <History
                items={history}
                onRestore={restoreFromHistory}
                onOpenPreview={setVideoPopup}
              />
            )}
          </div>
        </div>
      </main>

      {/* Asset Helper modal — rendered at root for full-screen overlay */}
      {assetModalTarget && (
        <AssetHelper
          suggestedKind={assetModalTarget.suggestedKind}
          onUseAsset={(uri) => { try { assetModalTarget.callback?.(uri); } catch (_) {} }}
          onClose={() => setAssetModalTarget(null)}
        />
      )}

      {/* Video popup (depth map preview, etc.) */}
      {videoPopup && (
        <VideoPopup
          src={videoPopup.src}
          title={videoPopup.title}
          onClose={() => setVideoPopup(null)}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-zinc-800 px-4 py-2">
        <div className="flex items-center justify-between text-[9px] text-zinc-600">
          <span>dreamina-seedance-2-0 · 24fps</span>
          <span>
            Powered by{" "}
            <a href="https://homolapis.ai" onClick={openExternalLink} className="text-brand-400 hover:underline cursor-pointer">Homo Lapis</a>
            {" · "}
            <a href="mailto:info@homolapis.ai" onClick={openExternalLink} className="text-brand-400 hover:underline cursor-pointer">info@homolapis.ai</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

function openExternalLink(e) {
  e.preventDefault();
  const href = e.currentTarget.getAttribute("href");
  try {
    if (typeof window !== "undefined" && window.cep?.util?.openURLInDefaultBrowser) {
      window.cep.util.openURLInDefaultBrowser(href);
      return;
    }
  } catch (_) {}
  window.open(href, "_blank", "noopener,noreferrer");
}

/**
 * Playground-style chip bar above the prompt textarea. One chip per attached
 * reference (image / video / audio). Clicking a chip inserts its @mention
 * token ("Image 1", "Video 2", "Audio 1") at the textarea caret.
 *
 * If nothing is attached, render a compact hint row so the affordance is
 * discoverable from the start.
 */
function ReferenceChipBar({ refImages, refVideos, refAudios, onInsertMention }) {
  const chips = [
    ...refImages.map((r) => ({ kind: "image", ...r })),
    ...refVideos.map((r) => ({ kind: "video", ...r })),
    ...refAudios.map((r) => ({ kind: "audio", ...r })),
  ];

  if (chips.length === 0) {
    return (
      <div className="text-[10px] text-zinc-600 px-2 py-1.5 bg-zinc-800/30 border border-zinc-800 rounded-lg leading-snug">
        Drop images / videos / audios below to attach references — then click them to cite as <span className="font-mono text-zinc-400">Image N</span> / <span className="font-mono text-zinc-400">Video N</span> / <span className="font-mono text-zinc-400">Audio N</span> in the prompt.
      </div>
    );
  }

  return (
    <div className="reference-chip-bar flex flex-wrap gap-1.5 p-1.5 bg-zinc-800/40 border border-zinc-700 rounded-lg">
      {chips.map((c, i) => (
        <button
          key={`${c.kind}-${c.label}-${i}`}
          onClick={() => onInsertMention(c.mention)}
          className="flex items-center gap-1.5 px-1.5 py-1 rounded-md bg-zinc-800 border border-zinc-700 hover:border-brand-500 hover:bg-zinc-800/80 transition group"
          title={`Insert "${c.mention}" at the cursor`}
        >
          {/* Thumbnail */}
          <div className="w-7 h-7 rounded overflow-hidden bg-zinc-900 flex-shrink-0 flex items-center justify-center">
            {c.kind === "image" && c.src && !c.src.startsWith("asset://") && (
              <img src={c.src} alt="" className="w-full h-full object-cover" />
            )}
            {c.kind === "video" && c.src && /^https?:\/\//.test(c.src) && (
              // preload="none" prevents Chromium from continuously fetching
              // metadata on every parent re-render (source of prompt-area flicker).
              <video src={c.src} muted playsInline preload="none" className="w-full h-full object-cover" />
            )}
            {c.kind === "audio" && (
              <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 19V6l12-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
            {(c.src?.startsWith?.("asset://")) && (
              <span className="text-[8px] text-zinc-400 font-mono">asset</span>
            )}
          </div>
          <span className="text-[10px] text-zinc-300 group-hover:text-white pr-0.5">{c.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Compact toggle row — single line with the label on the left and a switch on
 * the right. Used throughout the Configure panel to match BytePlus playground.
 */
function SlimToggle({ label, checked, onChange, hint }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between px-0.5 py-0.5 text-left group"
    >
      <div className="min-w-0">
        <div className={`text-[11px] font-medium ${checked ? "text-zinc-100" : "text-zinc-300"} group-hover:text-white transition`}>
          {label}
        </div>
        {hint && <div className="text-[9px] text-zinc-600">{hint}</div>}
      </div>
      <div
        className={`w-8 h-4 rounded-full relative transition-colors flex-shrink-0 ${
          checked ? "bg-brand-500" : "bg-zinc-600"
        }`}
      >
        <div
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </div>
    </button>
  );
}

function Toggle({ label, description, checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition ${
        checked
          ? "border-brand-500/50 bg-brand-500/10"
          : "border-zinc-700 bg-zinc-800/30 hover:border-zinc-600"
      }`}
    >
      <div
        className={`w-7 h-3.5 rounded-full relative transition-colors flex-shrink-0 ${
          checked ? "bg-brand-500" : "bg-zinc-600"
        }`}
      >
        <div
          className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </div>
      <div className="text-left">
        <div className={`text-[10px] font-medium ${checked ? "text-brand-300" : "text-zinc-400"}`}>
          {label}
        </div>
        {description && <div className="text-[9px] text-zinc-600">{description}</div>}
      </div>
    </button>
  );
}
