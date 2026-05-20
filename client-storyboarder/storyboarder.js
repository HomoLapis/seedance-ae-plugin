/* ===========================================================================
 *  Storyboarder — main panel logic.
 *
 *  Vanilla JS, no framework / build step. Mirrors the behaviour of the main
 *  Seedance Studio panel (same localStorage keys, same BytePlus ARK + Z.AI
 *  endpoints) so the two panels share API keys, output dir and total spend.
 *
 *  Architecture:
 *    - state.shots[]   — single source of truth, persisted to localStorage
 *    - render()        — rebuilds the DOM from state (idempotent)
 *    - api.*           — Seedance/Seedream/GLM HTTP calls
 *    - bridge.*        — AEBridge passthroughs (defined in ae-bridge-storyboarder.js)
 * ========================================================================= */

(function () {
"use strict";

/* ----------------------------- Constants -------------------------------- */

const ARK_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
const ZAI_URL  = "https://api.z.ai/api/paas/v4/chat/completions";

const LS = {
  ARK: "seedance_ark_key",
  ZAI: "seedance_zai_key",
  OUT: "seedance_output_dir",
  MOD: "seedance_model",
  SPENT: "seedance_total_spent",
  STATE: "storyboarder_state_v1"
};

// Seedance video models (mirror of main panel's Uh array)
const VIDEO_MODELS = {
  standard: { id: "dreamina-seedance-2-0-260128",      label: "Seedance 2.0 Standard", pricePerM: 7.00 },
  fast:     { id: "dreamina-seedance-2-0-fast-260128", label: "Seedance 2.0 Fast",     pricePerM: 5.60 }
};

// Seedream image model. We use the same model for both text-to-image and
// image-to-image; reference mode is triggered by the presence of `image:[]`
// in the request. (The older `doubao-seedream-3-0-t2i-250415` is
// deprecated/access-restricted on some ARK accounts — observed 401-style
// failure on this user's tenant.)
const IMAGE_MODEL = "seedream-5-0-260128";

// Map a shot aspect ratio → a Seedream-5 valid size (must be 3.6M..8M px,
// multiple of 64). Numbers picked to land just above the 3.6M minimum so
// the generation is fast but high-quality. These match the hardcoded sizes
// in the main panel's bundle.
const SEEDREAM_SIZE_BY_ASPECT = {
  "16:9":     "2560x1440",
  "9:16":     "1440x2560",
  "4:3":      "2304x1728",
  "3:4":      "1728x2304",
  "1:1":      "1920x1920",
  "21:9":     "2944x1280",
  "adaptive": "1920x1920"
};
function defaultSeedreamSize(aspect) {
  return SEEDREAM_SIZE_BY_ASPECT[aspect] || "1920x1920";
}

/** Pick the closest Seedance-supported aspect ratio for given pixel
 *  dimensions. Returns one of ASPECTS or null if w/h are missing. */
function aspectFromDimensions(w, h) {
  if (!w || !h) return null;
  const r = w / h;
  const candidates = [
    { id: "21:9", v: 21/9 },
    { id: "16:9", v: 16/9 },
    { id: "4:3",  v: 4/3 },
    { id: "1:1",  v: 1 },
    { id: "3:4",  v: 3/4 },
    { id: "9:16", v: 9/16 }
  ];
  let best = candidates[0], diff = Math.abs(r - best.v);
  for (let i = 1; i < candidates.length; i++) {
    const d = Math.abs(r - candidates[i].v);
    if (d < diff) { best = candidates[i]; diff = d; }
  }
  return best.id;
}

/** Pick a Seedance resolution from the comp's height. Seedance 2.0 only
 *  supports 480p and 720p — so any AE comp ≥ 720px tall maps to 720p. */
function resolutionFromHeight(h) {
  if (!h) return null;
  return h >= 720 ? "720p" : "480p";
}

// Concurrency for batch frame generation (Seedream is faster than Seedance).
const FRAME_BATCH_CONCURRENCY = 4;

// Anchor types for the visual reference. Each one steers the Seedream
// image-to-image generation differently via a tailored directive prefix.
// Designed for professional production: the same panel needs to handle
// brand work (logo, product), narrative work (character, setting,
// wardrobe) and stylistic work (style transfer).
const ANCHOR_TYPES = {
  character: {
    label:  "Character",
    desc:   "same person across shots — face, hair, body, expression",
    prefix: "Keep the SAME character (face, hair, body type, age, ethnicity, wardrobe) as the reference image. Place the character in the following scene without redesigning them:"
  },
  setting: {
    label:  "Setting / Environment",
    desc:   "same location, lighting, palette across shots",
    prefix: "Use the SAME setting, architecture, lighting register and color palette as the reference image. Re-stage the scene with the following action:"
  },
  product: {
    label:  "Product",
    desc:   "preserve product geometry, materials, branding",
    prefix: "Feature the SAME product as in the reference image — preserve its exact silhouette, proportions, materials, colors and visible branding. Compose the rest of the frame as:"
  },
  logo: {
    label:  "Logo / Brand mark",
    desc:   "place the brand mark cleanly in the frame",
    prefix: "Include the EXACT logo / brand mark from the reference image, rendered cleanly and readably (corner placement, product surface, or signage as appropriate to the scene). Do NOT alter the logo's design. Compose the rest of the frame as:"
  },
  style: {
    label:  "Visual style only",
    desc:   "borrow look & feel, not subject (style transfer)",
    prefix: "Match the visual STYLE of the reference image (color palette, line treatment, lighting, materials, rendering technique) but DO NOT copy its subject. Apply that style to a new scene depicting:"
  },
  wardrobe: {
    label:  "Wardrobe / Costume",
    desc:   "same outfit on different scenes/people",
    prefix: "Reproduce the SAME wardrobe / costume from the reference image (same garments, fabrics, colors, accessories) — apply it to the subject in the following scene:"
  },
  pose: {
    label:  "Pose / Composition",
    desc:   "same body pose or shot composition",
    prefix: "Reproduce the SAME pose / body language / overall composition as in the reference image. Adapt subject and environment as follows:"
  }
};
function anchorPrefix(type) {
  return (ANCHOR_TYPES[type] || ANCHOR_TYPES.character).prefix;
}

// GLM model for the storyboard assistant. Storyboard generation is a
// text-only reasoning task — no image input is needed — so we use the
// flagship reasoning model `glm-5.1` rather than the multimodal `glm-4.6v`.
const GLM_MODEL = "glm-5.1";

// Seedance 2.0 video resolution → pixel size (used for the cost formula).
// Official docs (ModelArk Seedance 2.0 series tutorial PDF): only 480p and
// 720p are supported by `dreamina-seedance-2-0-260128` and its `-fast`
// counterpart. 1080p is NOT a valid value for these models.
const RES_PX = {
  "480p":  { w:  854, h:  480 },
  "720p":  { w: 1280, h:  720 }
};

// Official supported aspect ratios for Seedance 2.0 (per the ModelArk
// tutorial PDF). "adaptive" is NOT in the spec and gets rejected.
const ASPECTS = ["16:9","9:16","4:3","3:4","1:1","21:9"];

// Per official docs: each video must be 4..15 seconds, INTEGER seconds
// (Seedance 2.0 series — both standard and fast models).
const MIN_DURATION = 4;
const MAX_DURATION = 15;
const DEFAULT_DURATION = 5;
function clampDuration(v) {
  const n = Math.round(Number(v) || DEFAULT_DURATION);
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, n));
}

// Concurrency cap for batch generation (sane default: 2 parallel ARK tasks)
const BATCH_CONCURRENCY = 2;

// AE label colours we cycle through (1..16; 0 means "None")
const LABEL_CYCLE = [9, 11, 5, 1, 13, 3, 7, 14, 12, 4, 8, 6, 10, 15, 2, 16];

// CSS hex for the same labels (approximate — for the timebar visual)
const LABEL_HEX = {
  0: "#52525b", 1: "#d44d4d", 2: "#d4a64d", 3: "#d4d44d", 4: "#7ed44d",
  5: "#4dd4a6", 6: "#4dd4d4", 7: "#4d7ed4", 8: "#7e4dd4", 9: "#d44d8a",
  10:"#a64d4d", 11:"#d47e4d", 12:"#d4d49a", 13:"#9ad49a", 14:"#9ad4d4",
  15:"#9a9ad4", 16:"#d49ad4"
};

/* ----------------------------- State ------------------------------------ */

// IMPORTANT — declaration order matters here.
//   loadState() → freshState() → defaultShot(1) reads aeStatus to inherit
//   the active comp's aspect/resolution. With `let`, accessing aeStatus
//   before its initializer triggers a Temporal Dead Zone ReferenceError,
//   which would kill the whole boot and leave the panel blank. So aeStatus
//   MUST be declared BEFORE state.
//
// aeStatus also caches the active comp's geometry so new shots can inherit
// its aspect + resolution by default — same pattern used by the main panel.
let aeStatus = {
  ready: false,
  compName: "",
  width: 0,
  height: 0,
  frameRate: 0,
  aspect: null,        // string from ASPECTS, derived from w/h
  resolution: null     // "480p" or "720p", picked from height
};
let state = loadState();
let assistantHistory = [];
let assistantInput = "";        // bound to the assistant textarea — survives re-renders
let collapsedAssistant = false;
let toastId = 0;

// Activity log — every API call appends here so the user can see what's
// happening. Capped to keep memory bounded.
const MAX_LOGS = 200;
let logs = [];                  // {ts, level: 'info'|'warn'|'error'|'success'|'cost', msg, detail?}
let logsCollapsed = false;

function defaultShot(index) {
  // If AE has an active comp, inherit its aspect and resolution so
  // generated frames + clips match the AE workspace by default.
  const compAspect = aeStatus && aeStatus.aspect;
  const compRes    = aeStatus && aeStatus.resolution;
  return {
    id: "s" + Date.now() + "_" + Math.random().toString(36).slice(2,7),
    index: index,
    prompt: "",
    duration: DEFAULT_DURATION,
    resolution: compRes    || "720p",
    aspect:     compAspect || "16:9",
    model: null,             // null = inherit the global default from Settings
    cameraFixed: false,
    generateAudio: false,
    seed: -1,
    firstFrame: null,        // { dataUrl, width, height, source: 'generated'|'capture'|'upload'|'sync'|'edit' }
    lastFrame: null,
    refOverride: null,       // { dataUrl, label } — per-shot reference, overrides global
    chainFromPrev: false,    // if true, firstFrame == prevShot.lastFrame (auto-linked)
    returnLastFrame: false,  // tells Seedance to return the last frame, used for chaining
    status: "idle",          // idle | queued | running | ready | failed
    progress: 0,
    taskId: null,
    videoPath: null,         // local file path of the saved video
    videoUrl: null,          // returned URL from ARK
    error: null,
    note: null               // free-form message shown under the status
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS.STATE);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.shots)) return freshState();
    // Merge missing top-level fields with defaults — older saved states may
    // be missing newly-introduced flags (e.g. autoSyncTimeline) and would
    // otherwise read as undefined → falsy, silently breaking features like
    // automatic placement into the AE timeline.
    const defaults = freshState();
    for (const k in defaults) {
      if (parsed[k] === undefined) parsed[k] = defaults[k];
    }
    // Clean up sticky flags from earlier panel versions that auto-flipped
    // state on user actions (e.g. clicking "Preview in AE" used to set
    // placeholderMode=true forever, silently swallowing future generations).
    parsed.placeholderMode = false;
    // Migrate legacy state: clamp any pre-existing sub-4s shot durations
    // (Seedance 2.0 hard min is 4s — older data from earlier panel versions
    // may have stored 1–3s values).
    parsed.shots.forEach(s => {
      if (typeof s.duration !== "number" || s.duration < 4 || s.duration > 15 || (s.duration % 1 !== 0)) {
        const clamped = Math.min(15, Math.max(4, Math.round(Number(s.duration) || 5)));
        s.duration = clamped;
      }
      if (typeof s.model === "undefined") s.model = null;
    });
    return parsed;
  } catch (e) { return freshState(); }
}
function freshState() {
  return {
    title: "Untitled storyboard",
    chainAll: false,             // auto-link last→first across shots when generating
    placeholderMode: false,      // insert image placeholders on AE timeline
    insertWithMarkers: true,     // add comp markers at each shot start
    insertWithLabelColors: true, // colour-code layers
    autoSyncTimeline: true,      // place clips into AE work area on success
    selectedShotId: null,
    visualReference: null,       // { dataUrl, label, source } — global character/setting ref
    refMode: "character",        // 'character' | 'setting' — how the ref should be honoured
    shots: [defaultShot(1)]
  };
}
function saveState() {
  try { localStorage.setItem(LS.STATE, JSON.stringify(state)); } catch (e) {}
}

function reindex() {
  state.shots.forEach((s, i) => { s.index = i + 1; });
}

/* ----------------------------- Helpers ---------------------------------- */

function $(sel, root) { return (root||document).querySelector(sel); }
function $$(sel, root) { return Array.from((root||document).querySelectorAll(sel)); }

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === "class")   e.className = attrs[k];
    else if (k === "style") e.setAttribute("style", attrs[k]);
    else if (k.startsWith("on") && typeof attrs[k] === "function")
      e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
    else if (attrs[k] === true)  e.setAttribute(k, "");
    else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
  }
  (children || []).forEach(c => {
    if (c == null || c === false) return;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return e;
}

function toast(msg, kind) {
  const stack = $("#toast-stack");
  if (!stack) return;
  const t = el("div", { class: "toast " + (kind || "info") }, [msg]);
  stack.appendChild(t);
  const id = ++toastId;
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, kind === "error" ? 6000 : 3000);
  setTimeout(() => t.remove(), kind === "error" ? 6500 : 3500);
  return id;
}

/* ----------------------------- Logging ---------------------------------- */

/** Append an event to the activity log and refresh the log panel.
 *  level ∈ {'info','warn','error','success','cost'} — the cost level is
 *  styled distinctly so spend events stand out. */
function logEvent(level, msg, detail) {
  logs.unshift({ ts: Date.now(), level: level || "info", msg: String(msg || ""), detail: detail || null });
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  renderLogsOnly();
}

/** Convenience helpers. */
const log = {
  info:    (m, d) => logEvent("info", m, d),
  ok:      (m, d) => logEvent("success", m, d),
  warn:    (m, d) => logEvent("warn", m, d),
  error:   (m, d) => logEvent("error", m, d),
  cost:    (m, d) => logEvent("cost", m, d)
};

/* ----------------------------- Shared config ---------------------------- */
/* Each CEP <Extension> has an isolated localStorage. Mirror the keys in a
   JSON file under the extension folder so settings survive panel reloads
   and can be re-imported into the main panel (manual paste) if desired. */

function sharedConfigPath() {
  try {
    const path = nodeRequire("path");
    const os   = nodeRequire("os");
    return path.join(os.homedir(), "AppData", "Roaming", "Adobe", "CEP", "extensions",
                     "com.seedance.studio", ".storyboarder-config.json");
  } catch (e) { return null; }
}

function loadSharedConfig() {
  try {
    const fs = nodeRequire("fs");
    const p = sharedConfigPath();
    if (!p || !fs.existsSync(p)) return false;
    const raw = fs.readFileSync(p, "utf8");
    const cfg = JSON.parse(raw);
    let touched = false;
    if (cfg.arkKey   && !localStorage.getItem(LS.ARK)) { localStorage.setItem(LS.ARK, cfg.arkKey);   touched = true; }
    if (cfg.zaiKey   && !localStorage.getItem(LS.ZAI)) { localStorage.setItem(LS.ZAI, cfg.zaiKey);   touched = true; }
    if (cfg.outputDir && !localStorage.getItem(LS.OUT)) { localStorage.setItem(LS.OUT, cfg.outputDir); touched = true; }
    if (cfg.model    && !localStorage.getItem(LS.MOD)) { localStorage.setItem(LS.MOD, cfg.model);    touched = true; }
    return touched;
  } catch (e) { return false; }
}

function saveSharedConfig() {
  try {
    const fs   = nodeRequire("fs");
    const path = nodeRequire("path");
    const p = sharedConfigPath();
    if (!p) return;
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const cfg = {
      arkKey:    localStorage.getItem(LS.ARK) || "",
      zaiKey:    localStorage.getItem(LS.ZAI) || "",
      outputDir: localStorage.getItem(LS.OUT) || "",
      model:     localStorage.getItem(LS.MOD) || "standard",
      _note: "Shared by Storyboarder. Each CEP panel has isolated localStorage; this file mirrors the keys so they survive panel reloads."
    };
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2), "utf8");
  } catch (e) { /* non-fatal */ }
}

/** Returns a list of names of missing required keys, e.g. ["ARK","Z.AI"]. */
function missingKeys() {
  const out = [];
  if (!localStorage.getItem(LS.ARK)) out.push("ARK");
  if (!localStorage.getItem(LS.ZAI)) out.push("Z.AI");
  return out;
}

function fmtMoney(n) { return "$" + (n || 0).toFixed(4); }
function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}
function modelObj() {
  const id = localStorage.getItem(LS.MOD) || "standard";
  return VIDEO_MODELS[id] || VIDEO_MODELS.standard;
}

/** Resolve the effective model for a shot. shot.model="standard"|"fast"|null
 *  — null means inherit the global default from Settings. */
function modelObjFor(shot) {
  const id = (shot && shot.model) || localStorage.getItem(LS.MOD) || "standard";
  return VIDEO_MODELS[id] || VIDEO_MODELS.standard;
}

/** Cost for one shot in USD, based on the same formula used by the main panel:
 *    tokens = w * h * 24fps * duration / 1024
 *    cost   = tokens / 1e6 * pricePerM
 */
function shotTokens(shot) {
  const r = RES_PX[shot.resolution] || RES_PX["720p"];
  return Math.round(r.w * r.h * 24 * clampDuration(shot.duration) / 1024);
}
function shotCostUSD(shot) {
  return shotTokens(shot) / 1e6 * modelObjFor(shot).pricePerM;
}
function totalCostUSD()  { return state.shots.reduce((sum, s) => sum + shotCostUSD(s), 0); }
function totalDuration() { return state.shots.reduce((sum, s) => sum + Number(s.duration || 0), 0); }

/* ----------------------------- Image utilities -------------------------- */

const FRAME_MAX_BYTES = 4_000_000; // ~4 MB cap before sending to ARK
const FRAME_MAX_DIM   = 2048;

/** Compress a data: URL (or http URL) to JPEG until below FRAME_MAX_BYTES. */
function compressDataUrl(input) {
  return new Promise(resolve => {
    if (!input || !input.startsWith("data:")) { resolve(input); return; }
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      const m = Math.max(w, h);
      if (m > FRAME_MAX_DIM) {
        const k = FRAME_MAX_DIM / m;
        w = Math.round(w * k); h = Math.round(h * k);
      }
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      for (const q of [0.85, 0.7, 0.55, 0.4]) {
        const out = cv.toDataURL("image/jpeg", q);
        const bytes = Math.round((out.split(",")[1] || "").length * 3 / 4);
        if (bytes <= FRAME_MAX_BYTES) { resolve(out); return; }
      }
      resolve(cv.toDataURL("image/jpeg", 0.4));
    };
    img.onerror = () => resolve(input);
    img.src = input;
  });
}

/** Read a file from disk into a data: URL. CEP exposes Node.js — use require('fs'). */
function readFileAsDataUrl(filePath, mime) {
  return new Promise((resolve, reject) => {
    try {
      const fs   = nodeRequire("fs");
      const path = nodeRequire("path");
      if (!fs.existsSync(filePath)) { reject(new Error("File not found: " + filePath)); return; }
      const buf = fs.readFileSync(filePath);
      const ext = (path.extname(filePath) || "").toLowerCase();
      const m = mime ||
        (ext === ".png"  ? "image/png"  :
         ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
         ext === ".webp" ? "image/webp" :
         ext === ".tif" || ext === ".tiff" ? "image/tiff" :
         "image/png");
      resolve("data:" + m + ";base64," + buf.toString("base64"));
    } catch (e) { reject(e); }
  });
}

/** Write a base64 payload to disk as a binary file. */
function writeBase64ToFile(b64, outPath) {
  const fs = nodeRequire("fs");
  const path = nodeRequire("path");
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
}

/** Download a URL to a local path (used to save Seedance output videos). */
async function downloadToFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Download failed: " + res.status + " " + res.statusText);
  const buf = await res.arrayBuffer();
  const fs = nodeRequire("fs");
  const path = nodeRequire("path");
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(buf));
  return outPath;
}

/** Extract the LAST frame of a video file as a dataURL — used for "Return last frame"
 *  chaining when ARK doesn't return the last frame inline. We use a local <video>
 *  + canvas. */
function extractLastFrameDataUrl(videoPath) {
  return new Promise((resolve, reject) => {
    try {
      const v = document.createElement("video");
      v.muted = true; v.preload = "auto";
      v.onerror = () => reject(new Error("Video load failed: " + videoPath));
      v.onloadedmetadata = () => {
        // seek to last frame minus a tiny epsilon
        v.currentTime = Math.max(0, v.duration - 0.05);
      };
      v.onseeked = () => {
        const cv = document.createElement("canvas");
        cv.width = v.videoWidth; cv.height = v.videoHeight;
        cv.getContext("2d").drawImage(v, 0, 0);
        try { resolve(cv.toDataURL("image/jpeg", 0.9)); }
        catch (e) { reject(e); }
      };
      // CEP allows file:// URIs with the --allow-file-access-from-files flag
      v.src = "file:///" + String(videoPath).replace(/\\/g, "/");
    } catch (e) { reject(e); }
  });
}

function nodeRequire(mod) {
  if (typeof window !== "undefined" && typeof window.require === "function") {
    return window.require(mod);
  }
  if (typeof require === "function") return require(mod);
  throw new Error("Node.js require() not available — Storyboarder needs CEP runtime.");
}

/* ----------------------------- Output paths ----------------------------- */

function defaultOutputDir() {
  try {
    const os = nodeRequire("os");
    const path = nodeRequire("path");
    return path.join(os.homedir(), "Seedance");
  } catch (e) { return ""; }
}

function outputDir() { return localStorage.getItem(LS.OUT) || defaultOutputDir(); }

/* Unified, project- and comp-aware save root. All Storyboarder output
 * (frames, clips, references) is bucketed into:
 *
 *     <baseDir>/Storyboarder/<comp-name-or-title>/<subdir>/
 *
 * where baseDir is, in priority order:
 *   1. The folder containing the saved AE project (.aep).
 *   2. The output directory from Settings.
 *   3. ~/Seedance (final fallback).
 *
 * We cache the resolved root per (baseDir, label) tuple so repeated saves
 * within a session don't pay the cost of asking AE every time.
 */
const _projectDirCache = {};
async function projectAssetsDir(subdir) {
  let baseDir = null;
  let baseSrc = "settings";
  if (AEBridge.isInAE()) {
    try {
      const r = await AEBridge.getProjectDir();
      if (r && r.path) { baseDir = r.path; baseSrc = "project"; }
    } catch (e) { /* fall back below */ }
  }
  if (!baseDir) baseDir = outputDir();
  if (!baseDir) baseDir = defaultOutputDir();

  // Use the active comp name when present, else the storyboard title.
  // The AE comp name carries more meaning to the user when this folder
  // is being browsed alongside other render outputs.
  const labelRaw = (aeStatus && aeStatus.compName) || state.title || "untitled";
  const label = labelRaw.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60) || "untitled";

  const cacheKey = baseDir + "::" + label + "::" + (subdir || "");
  if (_projectDirCache[cacheKey]) return _projectDirCache[cacheKey];

  try {
    const path = nodeRequire("path");
    const fs   = nodeRequire("fs");
    const dir = path.join(baseDir, "Storyboarder", label, subdir || "");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    _projectDirCache[cacheKey] = dir;
    if (Object.keys(_projectDirCache).length === 1) {
      // Log the chosen root once so the user always knows where things go.
      log.info("Output root · " + baseSrc + " · " + path.join(baseDir, "Storyboarder", label));
    }
    return dir;
  } catch (e) { return null; }
}
function resetAssetDirCache() {
  for (const k in _projectDirCache) delete _projectDirCache[k];
}

// Convenience wrappers so the call sites stay readable.
const clipsDir      = () => projectAssetsDir("clips");
const framesDir     = () => projectAssetsDir("frames");
const referencesDir = () => projectAssetsDir("references");

/** Persist a base64-decoded image to the project-aware assets dir.
 *  Returns the saved file path. Filename is stable so re-generation
 *  overwrites cleanly (no piles of timestamped duplicates). */
async function saveImageAsset(dataUrl, baseName, kind) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Not a data URL.");
  const mime = m[1] || "image/png";
  const b64  = m[2];
  const ext  = mime.indexOf("jpeg") >= 0 ? "jpg" : (mime.indexOf("webp") >= 0 ? "webp" : "png");
  const dir = await (kind === "reference" ? referencesDir() : framesDir());
  if (!dir) throw new Error("Could not resolve save directory.");
  const path = nodeRequire("path");
  const safe = String(baseName || "asset").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  const out  = path.join(dir, safe + "." + ext);
  writeBase64ToFile(b64, out);
  return out;
}

/* ----------------------------- ARK / Seedance / Seedream / GLM ---------- */

function arkKey() { return localStorage.getItem(LS.ARK) || ""; }
function zaiKey() { return localStorage.getItem(LS.ZAI) || ""; }

/** Create a Seedance video task. Returns { task: { id, ... } }. */
async function seedanceCreateTask(shot) {
  const key = arkKey();
  if (!key) throw new Error("ARK API key not set — open Storyboarder Settings (⚙ top-right) and add it. Each CEP panel has isolated storage, so the main panel's key isn't visible here.");

  const content = [{ type: "text", text: (shot.prompt || "").trim() }];
  let mode = "t2v";
  if (shot.firstFrame && shot.firstFrame.dataUrl) {
    const ff = await compressDataUrl(shot.firstFrame.dataUrl);
    content.push({ type: "image_url", image_url: { url: ff }, role: "first_frame" });
    mode = "i2v";
    if (shot.lastFrame && shot.lastFrame.dataUrl) {
      const lf = await compressDataUrl(shot.lastFrame.dataUrl);
      content.push({ type: "image_url", image_url: { url: lf }, role: "last_frame" });
      mode = "i2v_fl";
    }
  }

  const body = {
    model: modelObjFor(shot).id,
    content: content,
    resolution: shot.resolution || "720p",
    ratio: shot.aspect || "16:9",
    duration: clampDuration(shot.duration),
    generate_audio: !!shot.generateAudio,
    watermark: false,
    seed: Number.isFinite(shot.seed) && shot.seed >= 0 ? shot.seed : -1
  };
  if (shot.returnLastFrame === true) body.return_last_frame = true;
  if (mode === "t2v" || mode === "i2v") {
    if (typeof shot.cameraFixed === "boolean") body.camera_fixed = shot.cameraFixed;
  }

  log.info("Seedance · creating task for shot " + shot.index +
           " (mode=" + mode + ", " + body.resolution + ", " + body.duration + "s, " + body.ratio + ")");
  const r = await fetch(ARK_BASE + "/contents/generations/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const msg = (j.error && j.error.message) || j.message || ("ARK error " + r.status + ": " + r.statusText);
    log.error("Seedance · create-task failed for shot " + shot.index + ": " + msg);
    throw new Error(msg);
  }
  return await r.json();
}

async function seedanceGetTask(taskId) {
  const r = await fetch(ARK_BASE + "/contents/generations/tasks/" + encodeURIComponent(taskId), {
    headers: { Authorization: "Bearer " + arkKey() }
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error("Poll failed " + r.status + ": " + (j?.error?.message || r.statusText));
  }
  return await r.json();
}

/** Generate a still image with Seedream. Returns a data: URL. */
/** Read intrinsic dimensions from an image data URL. */
function imageSize(dataUrl) {
  return new Promise(resolve => {
    if (!dataUrl) { resolve(null); return; }
    const img = new Image();
    img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** Seedream-5 (image-to-image) accepts sizes in 3.6M..8M total pixels rounded
 *  to multiples of 64. Mirror of the formula used by the main panel's H1(). */
function clampSeedreamSize(w, h) {
  const MIN = 3686400, MAX = 7990272;
  let A = Math.max(1, w * h);
  if (A < MIN) { const k = Math.sqrt(MIN / A); w *= k; h *= k; }
  else if (A > MAX) { const k = Math.sqrt(MAX / A); w *= k; h *= k; }
  const round64 = v => Math.max(64, Math.round(v / 64) * 64);
  let R = round64(w), O = round64(h), n = 0;
  while (R * O < MIN && n++ < 64) { (R <= O) ? R += 64 : O += 64; }
  n = 0;
  while (R * O > MAX && n++ < 64) { (R >= O) ? R -= 64 : O -= 64; }
  return R + "x" + O;
}

/** Text-to-image with Seedream 5 (no reference image). */
async function seedreamGenerate(prompt, opts) {
  const key = arkKey();
  if (!key) throw new Error("ARK API key not set — open Storyboarder Settings (⚙ top-right) and add it.");
  if (!prompt || !prompt.trim()) throw new Error("No prompt.");
  opts = opts || {};
  const body = {
    model: IMAGE_MODEL,
    prompt: prompt.trim(),
    response_format: "b64_json",
    size: opts.size || defaultSeedreamSize(opts.aspect),
    watermark: false
  };
  log.info("Seedream T2I · " + body.size + " · " + prompt.slice(0, 60) + (prompt.length > 60 ? "…" : ""));
  const t0 = Date.now();
  const r = await fetch(ARK_BASE + "/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const msg = (j.error && j.error.message) || j.message || ("Seedream T2I error " + r.status);
    log.error("Seedream T2I · failed: " + msg);
    throw new Error(msg);
  }
  const data = await r.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) { log.error("Seedream T2I · no image in response"); throw new Error("No image in Seedream response."); }
  log.ok("Seedream T2I · image ready in " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
  return "data:image/png;base64," + b64;
}

/** Image-to-image with Seedream 5. Used for:
 *    - generating frames that should match a global character/setting reference;
 *    - editing an existing frame in place ("apply this prompt to this image").
 *
 *  `referenceDataUrl` is the source image (dataURL). The output will inherit
 *  its proportions / subject — this is what gives us cross-shot coherence.
 *  If `prompt` mentions modifications, only those will be applied. */
async function seedreamWithReference(referenceDataUrl, prompt, opts) {
  const key = arkKey();
  if (!key) throw new Error("ARK API key not set — open Storyboarder Settings (⚙ top-right) and add it.");
  if (!referenceDataUrl) throw new Error("No reference image.");
  if (!prompt || !prompt.trim()) throw new Error("No prompt.");
  opts = opts || {};

  // Compress the reference under ARK's payload limit, then derive a Seedream
  // valid output size from the reference (so the generated image keeps the
  // reference's aspect — important for matching the storyboard's chosen aspect).
  const compressed = await compressDataUrl(referenceDataUrl);
  let size = opts.size;
  if (!size) {
    const dims = await imageSize(compressed);
    size = (dims && dims.w > 0 && dims.h > 0)
      ? clampSeedreamSize(dims.w, dims.h)
      : "1024x1024";
  }

  const body = {
    model: IMAGE_MODEL,
    prompt: prompt.trim(),
    image: [compressed],
    size: size,
    response_format: "b64_json",
    watermark: false
  };
  log.info("Seedream-5 ref · " + size + " · " + prompt.slice(0, 60) + (prompt.length > 60 ? "…" : ""));
  const t0 = Date.now();
  const r = await fetch(ARK_BASE + "/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const msg = (j.error && j.error.message) || j.message || ("Seedream-5 ref error " + r.status);
    log.error("Seedream-5 ref · failed: " + msg);
    throw new Error(msg);
  }
  const data = await r.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) { log.error("Seedream-5 ref · no image in response"); throw new Error("No image in Seedream-5 response."); }
  log.ok("Seedream-5 ref · image ready in " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
  return "data:image/png;base64," + b64;
}

/** Build the GLM system prompt grounded in BytePlus's official Seedance
 *  prompt guide. ENGLISH-ONLY is enforced because Seedance officially
 *  supports only Chinese and English (Italian/French/etc. degrade quality
 *  even when the user writes the brief in those languages). */
function buildAssistantSystemPrompt() {
  return [
"You are a professional STORYBOARD ASSISTANT for video productions generated with **Seedance 2.0** (BytePlus ModelArk, model `dreamina-seedance-2-0-260128`). Your job is to turn the user's brief into a structured shot list and produce production-grade prompts.",
"",
"# HARD CONSTRAINTS (do not violate — verified against the official ModelArk Seedance 2.0 series tutorial PDF)",
"  1. **OUTPUT ONLY ENGLISH** for every `prompt`, `camera` and `note` field. Seedance officially supports Chinese and English only — Italian, French, German etc. produce degraded results. If the user writes in any other language, *translate their intent* into English.",
"  2. Each shot's `duration` is an **INTEGER, MINIMUM 4, MAXIMUM 15 SECONDS**. Never emit 1, 2 or 3. Never emit fractions like 4.5. Seedance 2.0 (`dreamina-seedance-2-0-260128` and `-fast`) rejects anything outside [4,15] and rejects fractional seconds.",
"  3. Default to **4–7 second shots** unless the user explicitly asks for slower pacing.",
"  4. Each `prompt` is **≤ 1000 words** (per the BytePlus docs).",
"  5. Output a STRICT JSON object — no preamble, no commentary, no markdown fences. Shape:",
"     `{ \"shots\": [ { \"prompt\": str, \"duration\": integer 4..15, \"camera\": str, \"note\": str }, ... ] }`",
"  6. Supported `aspect`/`ratio` values are exactly: 16:9, 9:16, 4:3, 3:4, 1:1, 21:9 (don't suggest others).",
"  7. Supported `resolution` values are exactly: 480p, 720p (1080p is NOT available for Seedance 2.0).",
"",
"# TOTAL-DURATION POLICY (important)",
"  • This panel is INSIDE After Effects. The user can — and will — trim, retime, and speed-ramp the clips during post-production.",
"  • Therefore: **DO NOT try to make the sum of shot durations match the user's stated total runtime.** Aim for natural shot pacing first; the total can overshoot the brief by several seconds.",
"  • If the user asks for a 10-second spot and the natural pacing yields 6 shots × 4–7s = 30–40s of source material, that is CORRECT — they will trim in AE. Do NOT compress shots below 4 seconds to fit a runtime. NEVER below 4.",
"",
"# SEEDANCE PROMPT FORMULA (official, from BytePlus docs)",
"     **Subject + Movement + Environment + Camera movement + Aesthetic description + Sound (optional)**",
"  • *Subject* — describe with feature-based attributes that stay consistent across the shot (e.g. \"a man in his thirties with short black hair, dark grey turtleneck\").",
"  • *Movement* — concrete actions and emotional progression, not vague verbs.",
"  • *Environment* — light direction, time of day, weather, materials.",
"  • *Camera movement* — use the OFFICIAL vocabulary (see CAMERA TERMS below).",
"  • *Aesthetic* — when relevant, anchor to a recognizable reference (\"in the style of Disney 2D animated movies\", \"Pixar style\", \"Hayao Miyazaki anime\", \"Cthulhu body-horror aesthetic\", \"Ghibli content style, solarpunk\").",
"  • *Sound* — only when the user wants audio: dialogue lines in quotes with speaker tag, BGM mood, or ambient SFX.",
"",
"# CAMERA TERMS (use exactly these)",
"  • Angles: high angle, low angle, eye-level, bird's-eye, over-the-shoulder, ant perspective.",
"  • Shot sizes: wide shot, full shot, medium shot, medium close-up, close-up, big close-up, headshot, bust, half-length portrait.",
"  • Movements: dolly-in, dolly-out, pan (left/right), track, follow, rise, fall, whirl, rotate, surround, zoom-in, zoom-out, Hitchcock zoom, handheld.",
"  • Movement description formula: *starting frame composition + camera move + amplitude + ending frame composition*.",
"",
"# CONTINUITY ACROSS SHOTS",
"  • Re-state the subject's feature description in every shot where they appear — Seedance has no memory between shots.",
"  • If the user's brief implies the same character/setting across multiple shots, repeat their canonical description verbatim.",
"  • Mention the same lighting register and palette across shots that should feel like the same scene.",
"",
"# WHEN THE USER ASKS FOR MULTI-CONCEPT / MONTAGE / TRANSFORMATION SPOTS",
"  • One shot per concept beat (before-state and after-state are usually two distinct shots).",
"  • Use the *Effects* discipline from the docs: accurately describe trigger moment + transformation process + post-transform details. Example: \"Starting from a flat, low-energy interview shot, a soft golden particle wave sweeps across the frame from left to right; as it passes, the influencer's face is reshaped into a Disney 2D-animated style with bold linework and saturated colours; the camera performs a slow dolly-in during the transition.\"",
"",
"# CANONICAL EXAMPLE (study the structure)",
"  prompt: \"A man around thirty-five with slightly wavy black hair stands in front of neon lights on a city street, facing the camera directly. He wears a knee-length black trench coat, a dark grey turtleneck, and leather gloves with metal buckles. His expression is calm yet oppressive. Neon reflections trace the contours of his face. The camera maintains a frontal perspective and slowly dollies in from a medium shot to a close-up; smooth motion, stable composition, steady lighting. The mood is film-noir, cinematic, neon-cyberpunk palette.\"",
"  duration: 5",
"  camera: \"frontal medium → close-up dolly-in\"",
"  note: \"Establishing the protagonist; same wardrobe and lighting register across the noir spot.\"",
"",
"# CONTEXT",
"The storyboard so far is in the conversation history. Refine, extend, or rewrite based on user feedback."
  ].join("\n");
}

/** Heuristic: returns true when more than 25% of the alphabetic characters
 *  in the text suggest Italian/French/Spanish/German rather than English.
 *  Used to detect cases where GLM returned non-English prompts despite the
 *  ENGLISH-ONLY directive — we then re-prompt with an explicit translation
 *  instruction. */
function looksNonEnglish(text) {
  if (!text) return false;
  const accented = (text.match(/[àèéìíòóùúâêîôûäëïöüÀÈÉÌÍÒÓÙÚÂÊÎÔÛÄËÏÖÜñçÑÇß]/g) || []).length;
  const alpha    = (text.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  if (alpha > 0 && (accented / alpha) > 0.02) return true; // accents at >2% density
  // Italian/Spanish stop-words appearing as standalone tokens
  const tokens = text.toLowerCase().match(/\b[a-zà-ÿ]{2,}\b/g) || [];
  if (!tokens.length) return false;
  const foreignStops = new Set([
    "il","lo","la","gli","le","un","una","uno","del","della","dei","delle","è","sono","con","per","che","sul","sulla","nel","nella","alla","della","quello","questa","questo","quella","ma","anche","molto","essere","fare","mostrare","crea","creare","gli","verso",
    "el","los","las","una","con","para","que","del","cuando","muy","también","ser","hacer","mostrar",
    "le","les","des","une","avec","pour","quand","très","être","faire","montrer","aussi",
    "der","die","das","den","mit","für","dass","sehr","sein","machen","zeigen","auch"
  ]);
  let hits = 0;
  for (const t of tokens) if (foreignStops.has(t)) hits++;
  return (hits / tokens.length) > 0.04;
}

/** Run the GLM storyboard assistant.
 *  If the assistant replies with non-English prompts despite the system
 *  directive, we automatically re-prompt with an explicit translation
 *  instruction (1 retry, logged). */
async function glmAssist(userMessage, history) {
  const key = zaiKey();
  if (!key) throw new Error("Z.AI key not set — open Storyboarder Settings (⚙ top-right) and add your Z.AI key. Each CEP panel has isolated storage, so the main panel's key isn't visible here.");

  const sys = buildAssistantSystemPrompt();

  const msgs = [{ role: "system", content: sys }];
  (history || []).forEach(h => msgs.push({ role: h.role, content: h.content }));
  msgs.push({ role: "user", content: userMessage });

  async function callGlm(messages, label) {
    log.info("GLM · " + label + " · " + GLM_MODEL);
    const t0 = Date.now();
    const r = await fetch(ZAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model: GLM_MODEL, messages: messages, temperature: 0.4 })
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const msg = (j.error && j.error.message) || j.message || ("GLM error " + r.status);
      log.error("GLM · failed: " + msg);
      throw new Error(msg);
    }
    const data = await r.json();
    const txt = data?.choices?.[0]?.message?.content || "";
    const usage = data?.usage || null;
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (usage) {
      log.ok("GLM · reply in " + dt + "s · " + (usage.total_tokens || 0) +
             " tok (in " + (usage.prompt_tokens || 0) + " · out " + (usage.completion_tokens || 0) + ")");
    } else {
      log.ok("GLM · reply in " + dt + "s");
    }
    return txt;
  }

  let txt = await callGlm(msgs, "first pass — " + userMessage.slice(0, 60) + (userMessage.length > 60 ? "…" : ""));

  // Auto-retry once if GLM violated either of the two hardest constraints:
  //   (a) ENGLISH-ONLY for every value, or
  //   (b) duration MUST be an integer in [4,15] (Seedance 2.0 rejects others).
  //
  // We parse the JSON, inspect every shot, and re-prompt with a targeted
  // directive listing exactly what was wrong — limited to ONE retry to bound
  // cost. The migration code on import (assistantSubmit) clamps as a final
  // safety net, but a clamp would silently change the model's output, so we
  // prefer to make GLM emit the right values.
  const shotsForCheck = parseShotsFromReply(txt) || [];
  const langOff = shotsForCheck.filter(s =>
    looksNonEnglish(s.prompt) || looksNonEnglish(s.camera) || looksNonEnglish(s.note)
  );
  const durOff = shotsForCheck.filter(s => {
    const d = Number(s.duration);
    return !Number.isFinite(d) || d < 4 || d > 15 || (d % 1 !== 0);
  });
  if (langOff.length > 0 || durOff.length > 0) {
    const issues = [];
    if (langOff.length) issues.push(langOff.length + "/" + shotsForCheck.length + " shots had non-English text");
    if (durOff.length)  issues.push(durOff.length  + "/" + shotsForCheck.length + " shots had invalid duration (must be integer 4..15)");
    log.warn("GLM · " + issues.join(" · ") + " — retrying with explicit fix directive.");
    const fixDirectives = [];
    if (langOff.length) fixDirectives.push("Translate EVERY `prompt`, `camera` and `note` value into natural cinematic English (no Italian, Spanish, French, German etc.).");
    if (durOff.length)  fixDirectives.push("Set EVERY `duration` to an INTEGER between 4 and 15 inclusive — never below 4, never fractional. If the original duration was 1, 2 or 3, replace it with 4. If it was 16+, replace it with 15. Do NOT try to keep the sum matching any total runtime — overshoot is fine because the user will trim in After Effects.");
    const retryMsgs = msgs.concat([
      { role: "assistant", content: txt },
      { role: "user", content:
        "Issues to fix:\n• " + fixDirectives.join("\n• ") +
        "\n\nRe-emit the SAME JSON object (same number of shots, same intent and structure), with all those fixes applied. Output JSON only, no commentary." }
    ]);
    txt = await callGlm(retryMsgs, "retry · " + issues.join(" + "));
  }

  return txt;
}

/* ----------------------------- Workflow --------------------------------- */

/** Run the full pipeline for a single shot: create task, poll, save video,
 *  optionally chain the last frame to the next shot, optionally place into AE. */
async function runShot(shot) {
  shot.status = "queued";
  shot.error = null;
  shot.note = null;
  renderShotsOnly();

  const tStart = Date.now();
  const estCost = shotCostUSD(shot);
  log.cost("Shot " + shot.index + " · estimated cost " + fmtMoney(estCost) + " · " +
           shotTokens(shot).toLocaleString() + " tok · " + shot.duration + "s @ " +
           shot.resolution + " · model=" + modelObjFor(shot).id);

  try {
    const created = await seedanceCreateTask(shot);
    shot.taskId = created.id || (created.task && created.task.id) || created.task_id || null;
    if (!shot.taskId) throw new Error("ARK didn't return a task id.");
    shot.status = "running";
    shot.progress = 5;
    log.ok("Shot " + shot.index + " · task queued: " + shot.taskId);
    renderShotsOnly();

    // Poll loop. ARK tasks usually finish in 30–120s.
    const t0 = Date.now();
    const MAX_WAIT = 6 * 60 * 1000; // 6 min
    let task = null;
    let pollN = 0;
    let lastReportedStatus = "";
    while (true) {
      await sleep(4000);
      pollN++;
      task = await seedanceGetTask(shot.taskId);
      const status = (task.status || "").toLowerCase();
      shot.progress = Math.min(95, shot.progress + 4);
      if (status && status !== lastReportedStatus) {
        log.info("Shot " + shot.index + " · poll #" + pollN + " · status=" + status +
                 " · elapsed " + Math.round((Date.now() - t0) / 1000) + "s");
        lastReportedStatus = status;
      }
      if (status === "succeeded" || status === "success" || status === "ready" || status === "done") break;
      if (status === "failed" || status === "cancelled" || status === "canceled" || status === "error") {
        throw new Error("Seedance task " + status + ": " + (task.error?.message || JSON.stringify(task).slice(0, 240)));
      }
      if (Date.now() - t0 > MAX_WAIT) throw new Error("Seedance task timed out after 6 minutes.");
      renderShotsOnly();
    }

    // Pull video URL — same fallback chain the main panel uses.
    const videoUrl =
      task?.content?.video_url ||
      task?.content?.url       ||
      task?.output?.video_url  ||
      task?.output?.url        ||
      task?.video?.url         ||
      task?.outputs?.[0]?.url  ||
      null;
    if (!videoUrl) throw new Error("Task complete but no video URL in response: " + JSON.stringify(task).slice(0, 280));
    shot.videoUrl = videoUrl;
    log.ok("Shot " + shot.index + " · video ready, downloading…");

    // Save locally to <project|settings>/Storyboarder/<comp-name>/clips/
    const dir = await clipsDir();
    if (!dir) throw new Error("Could not resolve clips folder. Set an output dir in Settings (⚙ top-right).");
    const fname = "shot-" + String(shot.index).padStart(2, "0") + "-" + Date.now() + ".mp4";
    const outPath = nodeRequire("path").join(dir, fname);
    await downloadToFile(videoUrl, outPath);
    shot.videoPath = outPath;
    log.ok("Shot " + shot.index + " · saved to " + outPath);

    // Track total spend
    try {
      const cost = shotCostUSD(shot);
      const prev = parseFloat(localStorage.getItem(LS.SPENT) || "0") || 0;
      const next = prev + cost;
      localStorage.setItem(LS.SPENT, String(next));
      log.cost("Shot " + shot.index + " · billed " + fmtMoney(cost) +
               " · all-time spend " + fmtMoney(next));
    } catch (e) {}

    shot.status = "ready";
    shot.progress = 100;

    // If chainAll is on, propagate last frame → next shot.firstFrame
    if (state.chainAll) {
      const next = state.shots[shot.index]; // shot.index is 1-based, [shot.index] is the *next* one
      if (next && (!next.firstFrame || next.firstFrame.source === "chain")) {
        try {
          const lf = await extractLastFrameDataUrl(outPath);
          next.firstFrame = { dataUrl: lf, width: 0, height: 0, source: "chain" };
          next.chainFromPrev = true;
          log.info("Chain · last frame of shot " + shot.index + " → first frame of shot " + next.index);
          renderShotsOnly();
        } catch (eLF) {
          shot.note = "Couldn't extract last frame for chaining: " + eLF.message;
          log.warn("Chain · failed to extract last frame: " + eLF.message);
        }
      }
    }

    saveState();
    renderShotsOnly();
    log.ok("Shot " + shot.index + " · DONE in " + ((Date.now() - tStart) / 1000).toFixed(1) + "s");
    return shot;
  } catch (e) {
    shot.status = "failed";
    shot.error = e.message || String(e);
    log.error("Shot " + shot.index + " · FAILED: " + shot.error);
    saveState();
    renderShotsOnly();
    throw e;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Run a batch with limited concurrency. The list of shots is ordered;
 *  if `state.chainAll` is on, shots that depend on the previous one's last
 *  frame are forced to wait — so we process strictly serially in that case. */
async function runBatch(shots) {
  if (!shots.length) return;
  const totalEst = shots.reduce((sum, s) => sum + shotCostUSD(s), 0);
  log.cost("Batch · " + shots.length + " shot(s) · estimated total " + fmtMoney(totalEst) +
           " · mode=" + (state.chainAll ? "chained/serial" : "parallel x" + BATCH_CONCURRENCY));
  const tBatch = Date.now();

  if (state.chainAll) {
    for (const s of shots) {
      try { await runShot(s); }
      catch (e) {
        toast("Shot " + s.index + " failed: " + e.message, "error");
        log.warn("Batch · stopping (chained mode) after shot " + s.index + " failure");
        break;
      }
    }
  } else {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(BATCH_CONCURRENCY, shots.length) }, async () => {
      while (cursor < shots.length) {
        const s = shots[cursor++];
        try { await runShot(s); }
        catch (e) { /* error already on shot.error and in log */ }
      }
    });
    await Promise.all(workers);
  }

  const okCount   = shots.filter(s => s.status === "ready").length;
  const failCount = shots.filter(s => s.status === "failed").length;
  log.ok("Batch · finished in " + ((Date.now() - tBatch) / 1000).toFixed(1) + "s · " +
         okCount + " ready · " + failCount + " failed");

  // Auto-place into AE on success — surface the skip reason explicitly so
  // the user always knows whether the clips were placed and, if not, why.
  if (okCount === 0) {
    log.warn("AE · auto-place skipped: no clips ready (all failed).");
  } else if (!state.autoSyncTimeline) {
    log.warn("AE · auto-place skipped: 'Auto-place' toggle is OFF in toolbar. " +
             "Click '⤴ Place ready clips' to place them manually.");
  } else if (!AEBridge.isInAE()) {
    log.warn("AE · auto-place skipped: not running inside After Effects (CSInterface unavailable).");
  } else {
    log.info("AE · auto-placing " + okCount + " ready clip(s) into the work area…");
    await placeReadyShotsIntoAE(shots);
  }
}

async function placeReadyShotsIntoAE(shots) {
  const ready = shots.filter(s => s.status === "ready" && s.videoPath);
  if (!ready.length) { toast("No ready clips to place.", "info"); return; }

  // Layout policy: each clip's startTime is the SUM of every preceding shot's
  // duration in the FULL storyboard (state.shots), not just in the current
  // batch. So clip 1 always starts at the work-area start, clip 2 always
  // starts at duration(clip 1), clip 3 at duration(1)+duration(2), etc. —
  // even when the user generates clips one at a time. Without this, every
  // single-shot generation would land at startTime=0 and overlap.
  //
  // We index by shot.index → expected startTime offset from work-area start.
  const offsetByIndex = new Map();
  let cursorAll = 0;
  for (const s of state.shots) {
    offsetByIndex.set(s.index, cursorAll);
    cursorAll += clampDuration(s.duration);
  }

  const payload = ready.map(s => ({
    shotIndex:  s.index,
    path:       s.videoPath,
    name:       layerNameFor(s),
    prompt:     s.prompt,
    startTime:  offsetByIndex.get(s.index) ?? 0,
    labelColor: state.insertWithLabelColors ? LABEL_CYCLE[(s.index - 1) % LABEL_CYCLE.length] : 0,
    marker:     state.insertWithMarkers
  }));

  try {
    // Path 1 — placeholderMode: try to swap rendered clips into existing
    // placeholder layers. If NONE of the placeholders match (typical when
    // the user never clicked Preview, or a stale `placeholderMode=true`
    // lingered in localStorage), fall through to direct placement instead
    // of silently doing nothing.
    if (state.placeholderMode) {
      const reps = ready.map(s => ({
        shotIndex:  s.index,
        videoPath:  s.videoPath,
        layerName:  layerNameFor(s),
        prompt:     s.prompt,
        labelColor: state.insertWithLabelColors ? LABEL_CYCLE[(s.index - 1) % LABEL_CYCLE.length] : 0,
        marker:     state.insertWithMarkers
      }));
      const r = await AEBridge.replacePlaceholdersWithRenders(reps);
      if (r && r.error) throw new Error(r.error);
      const results = (r && r.results) || [];
      const okRep   = results.filter(x => !x.error);
      const failRep = results.filter(x =>  x.error);
      failRep.forEach(x => log.warn("AE · placeholder #" + x.shotIndex + " not replaced: " + x.error));
      if (okRep.length > 0) {
        log.ok("AE · replaced " + okRep.length + "/" + results.length + " placeholder(s) with rendered clips");
        toast("Replaced " + okRep.length + " placeholders.", "success");
        return;
      }
      log.warn("AE · no placeholders matched — falling back to direct placement on the timeline.");
    }

    // Path 2 — direct placement at sequential offsets from work-area start.
    const totalAll = state.shots.reduce((a, s) => a + clampDuration(s.duration), 0);
    const wa = await AEBridge.getWorkAreaInfo();
    if (wa && wa.error) log.warn("AE · getWorkAreaInfo: " + wa.error);
    if (wa && wa.success) {
      log.info("AE · workArea before: start=" + wa.workAreaStart + "s, dur=" + wa.workAreaDuration + "s · comp=" + wa.compName);
      if (wa.workAreaDuration < totalAll) {
        const setRes = await AEBridge.setWorkArea(wa.workAreaStart, totalAll);
        if (setRes && setRes.error) log.warn("AE · setWorkArea: " + setRes.error);
        else log.info("AE · workArea extended to " + totalAll + "s to fit storyboard");
      }
    }
    log.info("AE · calling placeStoryboardClips with " + payload.length + " clip(s): " +
             payload.map(p => "#" + p.shotIndex + "@" + p.startTime + "s → " + p.path).join(" · "));
    const r = await AEBridge.placeStoryboardClips(payload, true);
    if (!r) throw new Error("placeStoryboardClips returned no response (ExtendScript may have errored).");
    if (r.error) throw new Error(r.error);
    const placedResults = r.results || [];
    const okN   = placedResults.filter(x => !x.error).length;
    const failN = placedResults.filter(x =>  x.error).length;
    placedResults.filter(x => x.error).forEach(x =>
      log.error("AE · clip #" + x.shotIndex + " not placed: " + x.error)
    );
    if (okN === 0) {
      log.error("AE · placement returned 0 successful clips. Verify there's an active comp, the work area is set, and the layers panel is visible.");
      toast("Placement returned 0 clips — see log.", "error");
    } else {
      log.ok("AE · placed " + okN + (failN ? "/" + (okN + failN) : "") + " clip(s) into '" +
             (r.compName || "active comp") + "' · workArea total " + totalAll + "s");
      toast("Placed " + okN + " clip(s) into the timeline.", "success");
    }
  } catch (e) {
    log.error("AE placement failed: " + e.message);
    toast("AE placement failed: " + e.message, "error");
  }
}

function layerNameFor(shot) {
  const dur = Number(shot.duration || 0).toFixed(1);
  const head = (shot.prompt || "").trim().split(/\s+/).slice(0, 6).join(" ");
  const safeHead = head ? head.replace(/[^\w \-]/g, "").slice(0, 40) : "shot";
  return "SB-" + String(shot.index).padStart(2, "0") + " · " + dur + "s · " + safeHead;
}

/* ----------------------------- AE sync IN -------------------------------- */

async function syncFromWorkArea() {
  if (!AEBridge.isInAE()) { toast("Not running inside After Effects.", "error"); return; }
  let info;
  try {
    info = await AEBridge.scanWorkAreaImages();
  } catch (e) { toast("Scan failed: " + e.message, "error"); return; }
  if (!info || info.error) { toast(info?.error || "Scan failed.", "error"); return; }
  if (!info.items || !info.items.length) {
    toast("No image layers found in the work area.", "info");
    return;
  }

  // Build shots by reading each image layer as the firstFrame; if the next
  // layer overlaps or is adjacent, use it as the lastFrame of the same shot.
  const items = info.items;
  const newShots = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    const b = items[i + 1] || null;

    let firstDU = null, lastDU = null;
    try { firstDU = await readFileAsDataUrl(a.path); }
    catch (e) { toast("Read failed: " + a.path, "error"); }

    // Decide if there's a "next" first-frame on the timeline that should
    // be treated as this shot's last frame. Heuristic: take the next image
    // as last-frame if their time-distance is < 15s.
    let useAsLast = false;
    if (b && (b.inPoint - a.inPoint) > 0 && (b.inPoint - a.inPoint) <= MAX_DURATION) {
      useAsLast = true;
      try { lastDU = await readFileAsDataUrl(b.path); } catch (e) {}
    }

    const dur = useAsLast
      ? clampDuration(b.inPoint - a.inPoint)
      : DEFAULT_DURATION;

    const shot = defaultShot(newShots.length + 1);
    shot.duration = Number(dur.toFixed(2));
    shot.firstFrame = firstDU ? { dataUrl: firstDU, width: a.width, height: a.height, source: "sync" } : null;
    if (useAsLast && lastDU) shot.lastFrame = { dataUrl: lastDU, width: b.width, height: b.height, source: "sync" };
    shot.note = "Synced from layer #" + a.aeIndex;
    newShots.push(shot);
  }

  if (!newShots.length) { toast("Nothing usable in scan result.", "info"); return; }

  const replace = confirm(
    "Found " + items.length + " image layers in the work area.\n" +
    "Replace the current storyboard with " + newShots.length + " synced shots?\n\n" +
    "OK = replace · Cancel = append"
  );
  state.shots = replace ? newShots : state.shots.concat(newShots);
  reindex();
  saveState();
  render();
  toast("Imported " + newShots.length + " shots from work area.", "success");
}

/* ----------------------------- Rendering --------------------------------- */

function render() {
  const root = $("#root");
  root.innerHTML = "";
  root.append(
    renderTopBar(),
    renderKeyBanner(),    // shows only when keys are missing
    renderCostStrip(),
    renderShell(),
    renderLogPanel(),
    el("div", { id: "toast-stack", class: "toast-stack" }),
    el("div", { id: "modal-host" })
  );
  rebuildTimebar();
}

/* Banner shown at the top when one or more required API keys are missing.
 * Links straight to Storyboarder's own Settings modal — clearly stating the
 * per-panel storage isolation so the user understands why the main panel's
 * key isn't visible here. */
function renderKeyBanner() {
  const missing = missingKeys();
  if (!missing.length) return el("div", { class: "key-banner-spacer" });
  return el("div", { class: "key-banner" }, [
    el("span", { class: "icon" }, ["⚠"]),
    el("span", null, [
      "Missing API key" + (missing.length > 1 ? "s" : "") + ": ",
      el("strong", null, [missing.join(" + ")]),
      ". Storyboarder uses its own storage — add the key" + (missing.length > 1 ? "s" : "") + " here, not in the main Seedance panel."
    ]),
    el("div", { class: "spacer", style: "flex:1" }),
    el("button", { class: "primary btn-sm", onClick: openSettingsModal }, ["Open Settings"])
  ]);
}

/* Activity log: persistent strip at the bottom showing every API call,
 * cost event, AE op and error. Collapsible to ~22px when not needed. */
function renderLogPanel() {
  const wrap = el("div", { class: "log-panel" + (logsCollapsed ? " collapsed" : "") });
  const totalCost = (() => {
    let sum = 0;
    logs.forEach(l => {
      if (l.level !== "cost") return;
      const m = l.msg.match(/\$(\d+\.\d+)/);
      if (m) sum += parseFloat(m[1]);
    });
    return sum; // not exposed — just used internally if we ever want a session total
  })();
  const head = el("div", { class: "log-head" }, [
    el("button", { class: "ghost btn-sm",
      onClick: () => { logsCollapsed = !logsCollapsed; renderLogsOnly(); } },
      [logsCollapsed ? "▴ Activity log" : "▾ Activity log"]),
    el("span", { class: "kv mono", style: "font-size:10px;color:var(--text-faint);" },
      [logs.length + " entries"]),
    el("div", { class: "spacer", style: "flex:1" }),
    !logsCollapsed ? el("button", { class: "ghost btn-sm",
      onClick: () => { logs = []; renderLogsOnly(); } }, ["Clear"]) : null,
    !logsCollapsed ? el("button", { class: "ghost btn-sm",
      onClick: copyLogsToClipboard, title: "Copy log to clipboard" }, ["⎘ Copy"]) : null
  ]);
  wrap.appendChild(head);
  if (!logsCollapsed) {
    const body = el("div", { class: "log-body" });
    if (!logs.length) {
      body.appendChild(el("div", { class: "log-empty" },
        ["No activity yet. API calls, costs and AE operations will appear here."]));
    }
    logs.slice(0, MAX_LOGS).forEach(l => {
      const t = new Date(l.ts).toTimeString().slice(0, 8);
      body.appendChild(el("div", { class: "log-row " + l.level }, [
        el("span", { class: "log-ts mono" }, [t]),
        el("span", { class: "log-icon" }, [iconForLog(l.level)]),
        el("span", { class: "log-msg" }, [l.msg])
      ]));
    });
    wrap.appendChild(body);
  }
  return wrap;
}

function iconForLog(level) {
  switch (level) {
    case "success": return "✓";
    case "error":   return "✕";
    case "warn":    return "⚠";
    case "cost":    return "$";
    default:        return "·";
  }
}

function renderLogsOnly() {
  const old = document.querySelector(".log-panel");
  if (old) old.replaceWith(renderLogPanel());
}

/* Open a fullscreen lightbox showing an image (data-URL or http URL).
 *  `meta` carries display info: { title, subtitle, path, onReplace }.
 *  Path enables an "Open in folder" / "Open file" action.
 */
function openImageLightbox(imgUrl, meta) {
  if (!imgUrl) return;
  meta = meta || {};
  const host = $("#modal-host");
  if (!host) return;
  host.innerHTML = "";
  const close = () => { host.innerHTML = ""; document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);

  const back = el("div", { class: "lightbox-back",
    onClick: (e) => { if (e.target === back) close(); } }, [
    el("div", { class: "lightbox" }, [
      el("div", { class: "lightbox-head" }, [
        el("div", { class: "lightbox-title" }, [
          el("strong", null, [meta.title || "Frame"]),
          meta.subtitle ? el("span", { class: "lightbox-sub mono" }, [meta.subtitle]) : null
        ]),
        el("div", { class: "lightbox-actions" }, [
          meta.path ? el("button", { class: "ghost btn-sm", title: meta.path,
            onClick: () => openInExplorer(meta.path) }, ["📁 Open in folder"]) : null,
          el("button", { class: "ghost btn-sm",
            onClick: () => downloadDataUrl(imgUrl, (meta.title || "frame").replace(/[^A-Za-z0-9._-]/g, "_") + ".png") },
            ["↓ Download"]),
          el("button", { class: "ghost btn-sm", onClick: close }, ["✕ Close (Esc)"])
        ])
      ]),
      el("div", { class: "lightbox-body" }, [
        el("img", { src: imgUrl, alt: meta.title || "frame" })
      ]),
      meta.footer ? el("div", { class: "lightbox-foot" }, [meta.footer]) : null
    ])
  ]);
  host.appendChild(back);
}

/** Trigger a browser download for a data URL. */
function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename || "image.png";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 100);
}

function copyLogsToClipboard() {
  const txt = logs.map(l => {
    const t = new Date(l.ts).toISOString();
    return "[" + t + "] " + l.level.toUpperCase() + " — " + l.msg;
  }).join("\n");
  try {
    navigator.clipboard.writeText(txt);
    toast("Log copied to clipboard.", "success");
  } catch (e) {
    toast("Copy failed: " + e.message, "error");
  }
}

function renderTopBar() {
  const cls = "ae-status" + (aeStatus.ready ? "" : " disconnected");
  const compStr = aeStatus.ready
    ? "Comp: " + (aeStatus.compName || "(none)") +
      (aeStatus.width ? " · " + aeStatus.width + "×" + aeStatus.height : "") +
      (aeStatus.aspect ? " (" + aeStatus.aspect + " · " + (aeStatus.resolution || "?") + ")" : "")
    : "After Effects not connected";
  return el("div", { class: "topbar" }, [
    el("h1", null, [
      "Storyboarder",
      el("span", { class: "badge mono" }, ["Seedance 2.0"])
    ]),
    el("div", { class: cls }, [el("span", { class: "dot" }), compStr]),
    el("div", { class: "spacer" }),
    el("button", { class: "ghost btn-sm", onClick: refreshAEStatus }, ["↻ AE"]),
    el("button", { class: "ghost btn-sm", onClick: openSettingsModal }, ["⚙ Settings"]),
  ]);
}

function renderCostStrip() {
  const total = totalCostUSD();
  const dur = totalDuration();
  const overShots = state.shots.filter(s => s.duration > MAX_DURATION).length;
  const m = modelObj();
  const totalSpent = parseFloat(localStorage.getItem(LS.SPENT) || "0") || 0;
  const children = [
    el("div", { class: "pill cost mono" }, [
      el("span", { class: "lbl" }, ["Batch cost"]),
      el("span", { class: "val" }, [fmtMoney(total)])
    ]),
    el("div", { class: "pill dur mono" }, [
      el("span", { class: "lbl" }, ["Total"]),
      el("span", { class: "val" }, [fmtTime(dur)]),
      el("span", { class: "lbl" }, ["·", state.shots.length + " shots"])
    ]),
    el("div", { class: "pill mono" }, [
      el("span", { class: "lbl" }, ["Model"]),
      el("span", { class: "val" }, [m.label]),
      el("span", { class: "lbl" }, ["·", "$" + m.pricePerM.toFixed(2) + "/M tok"])
    ]),
    el("div", { class: "pill mono" }, [
      el("span", { class: "lbl" }, ["All-time spend"]),
      el("span", { class: "val" }, [fmtMoney(totalSpent)])
    ])
  ];
  if (overShots > 0) {
    children.push(el("div", { class: "pill warn mono" }, [
      "⚠ " + overShots + " shot" + (overShots > 1 ? "s" : "") + " over 15s — split required"
    ]));
  }
  return el("div", { class: "cost-strip" }, children);
}

function renderShell() {
  return el("div", { class: "shell" }, [
    renderAssistant(),
    renderMain()
  ]);
}

function renderAssistant() {
  const wrap = el("div", { class: "assistant" + (collapsedAssistant ? " collapsed" : "") }, [
    el("div", { class: "head" }, [
      el("button", {
        class: "icon ghost", title: collapsedAssistant ? "Expand assistant" : "Collapse assistant",
        onClick: () => { collapsedAssistant = !collapsedAssistant; render(); }
      }, [collapsedAssistant ? "›" : "‹"]),
      el("h2", null, ["Storyboard Assistant"])
    ]),
    el("div", { class: "body" }, [
      el("div", { class: "hint" }, [
        "Describe your spot (e.g. \"30s ad for a red ring, sensual mood, 6 shots\") and I'll draft a shot list. Powered by GLM via z.ai."
      ]),
      ...assistantHistory.map(m => el("div", { class: "assistant-msg " + (m.role === "user" ? "user" : "") }, [m.content])),
      (() => {
        // Bind the textarea to the module-level `assistantInput` so its
        // content survives full re-renders (e.g. the AE-status poll every 4s).
        const ta = el("textarea", {
          id: "assistant-input", placeholder: "Describe your storyboard idea…",
          rows: "4",
          onInput: (e) => { assistantInput = e.target.value; }
        });
        ta.value = assistantInput;
        return ta;
      })(),
      el("div", { class: "row" }, [
        el("button", { class: "primary", onClick: assistantSubmit }, ["Generate shots"]),
        el("button", { class: "ghost btn-sm", onClick: assistantClear }, ["Clear"])
      ])
    ])
  ]);
  return wrap;
}

function renderMain() {
  return el("div", { class: "main" }, [
    renderToolbar(),
    renderVisualReference(),
    renderTimelineWrap(),
    renderShotsList()
  ]);
}

/* Visual reference section: a single image (uploaded or generated) that
 * Seedream-5 will use as anchor for every frame generation, so the
 * character/setting stays consistent across shots. Per-shot overrides are
 * surfaced in each shot card. */
function renderVisualReference() {
  const ref = state.visualReference;
  const previewBox = ref
    ? el("div", { class: "vref-thumb has-image", title: "Click to view full size",
        onClick: (e) => {
          if (e.target.closest(".vref-clear")) return;
          openImageLightbox(ref.dataUrl, {
            title:    "Visual reference · " + (ANCHOR_TYPES[state.refMode]?.label || state.refMode),
            subtitle: (ref.label || "") + (ref.path ? "" : "  (not saved to disk)"),
            path:     ref.path
          });
        } }, [
        el("img", { src: ref.dataUrl, alt: "visual reference" }),
        el("button", { class: "danger btn-sm vref-clear", title: "Clear reference",
          onClick: (e) => { e.stopPropagation(); setVisualReference(null); } }, ["×"])
      ])
    : el("div", { class: "vref-thumb empty", title: "No reference set" }, [
        el("span", null, ["No reference"]),
        el("span", { class: "sub" }, ["Add one for cross-shot coherence"])
      ]);

  return el("div", { class: "vref" }, [
    previewBox,
    el("div", { class: "vref-body" }, [
      el("div", { class: "vref-title" }, [
        "Visual reference",
        el("span", { class: "kv mono", style: "font-size:10px;color:var(--text-faint);margin-left:6px;" },
          [ref ? "active · " + (ref.source || "set") : "optional"])
      ]),
      el("div", { class: "vref-desc" }, [
        ref
          ? "Every frame generated from now on will inherit this image's character/setting (Seedream 5 image-to-image). Per-shot overrides available on each card via the 📌 button."
          : "Add a global character or setting reference. All generated frames will stay visually consistent (uses Seedream 5 image-to-image)."
      ]),
      el("div", { class: "vref-actions" }, [
        el("button", { class: "ghost btn-sm", onClick: uploadVisualReference }, ["↑ Upload"]),
        el("button", { class: "ghost btn-sm", onClick: generateVisualReference }, ["✨ Generate"]),
        el("div", { class: "spacer", style: "flex:1" }),
        el("label", { class: "kv mono", style: "font-size:11px;",
          title: ANCHOR_TYPES[state.refMode]?.desc || "How the reference should be honoured during generation" }, [
          el("span", { class: "lbl" }, ["Anchor:"]),
          el("select", {
            disabled: !ref,
            onChange: (e) => { state.refMode = e.target.value; saveState(); render(); }
          }, Object.keys(ANCHOR_TYPES).map(k => {
            const opt = el("option", { value: k }, [ANCHOR_TYPES[k].label]);
            if (state.refMode === k) opt.setAttribute("selected", "selected");
            return opt;
          }))
        ]),
        ref ? el("button", { class: "amber btn-sm",
          onClick: () => generateAllFirstFrames(true),
          title: "Re-generate every first frame using the current reference (overwrites existing)" },
          ["↻ Re-gen all with reference"]) : null
      ])
    ])
  ]);
}

function renderToolbar() {
  const m = modelObj();
  const totalCost = totalCostUSD();
  const hasShots = state.shots.length > 0;
  const overLimit = state.shots.some(s => s.duration > MAX_DURATION);
  const canGen = hasShots && !overLimit && state.shots.some(s => s.status !== "running");
  return el("div", { class: "toolbar" }, [
    el("input", {
      type: "text", value: state.title, placeholder: "Storyboard title…",
      style: "max-width: 260px;",
      onInput: (e) => { state.title = e.target.value; resetAssetDirCache(); saveState(); }
    }),
    el("div", { class: "spacer", style: "flex:1" }),

    el("button", { class: "ghost btn-sm", onClick: addShot }, ["+ Shot"]),
    el("button", { class: "ghost btn-sm", onClick: () => generateAllFirstFrames(false),
      title: "Generate first-frame images for every shot that doesn't already have one" },
      ["🖼  Generate all frames"]),
    (() => {
      const readyN = state.shots.filter(s => s.status === "ready" && s.videoPath).length;
      return el("button", {
        class: "teal btn-sm",
        disabled: readyN === 0 || !AEBridge.isInAE(),
        title: AEBridge.isInAE()
          ? (readyN
              ? "Manually place all " + readyN + " ready clip(s) into the active comp's work area, in order"
              : "No ready clips to place yet")
          : "Not running inside After Effects",
        onClick: () => placeReadyShotsIntoAE(state.shots)
      }, ["⤴ Place ready clips" + (readyN ? " (" + readyN + ")" : "")]);
    })(),
    el("button", { class: "ghost btn-sm", onClick: syncFromWorkArea, title: "Read image layers in the AE work area as a storyboard" },
      ["⤓ Sync from AE work area"]),
    el("button", { class: "ghost btn-sm", onClick: insertPlaceholdersInAE, title: "Insert all first frames as image placeholders in the work area" },
      ["⇌ Preview in AE"]),

    el("label", { class: "kv", title: "Auto-link last frame of shot N → first frame of shot N+1" }, [
      el("input", { type: "checkbox", checked: state.chainAll, onChange: (e) => { state.chainAll = e.target.checked; saveState(); } }),
      el("span", null, ["Chain frames"])
    ]),
    el("label", { class: "kv", title: "Insert clips into AE timeline after generation" }, [
      el("input", { type: "checkbox", checked: state.autoSyncTimeline, onChange: (e) => { state.autoSyncTimeline = e.target.checked; saveState(); } }),
      el("span", null, ["Auto-place"])
    ]),

    el("button", {
      class: "primary",
      disabled: !canGen,
      title: overLimit ? "Some shots exceed 15s — fix before generating" : ("Generate all shots — " + fmtMoney(totalCost)),
      onClick: () => runBatch(state.shots.filter(s => s.status !== "running"))
    }, ["▶  Generate all  ·  " + fmtMoney(totalCost)])
  ]);
}

function renderTimelineWrap() {
  return el("div", { class: "timeline-wrap" }, [
    el("div", { id: "timebar-host" })
  ]);
}

function rebuildTimebar() {
  const host = $("#timebar-host");
  if (!host) return;
  host.innerHTML = "";

  // Per-shot bar — one row per shot (since each shot's max is 15s).
  // We render one combined timeline showing all shots back-to-back, with
  // 15s reference ticks inside each shot box and red highlight if over.
  const wrap = el("div", { class: "timebar" });

  // Total duration & scale
  const total = Math.max(MAX_DURATION, totalDuration());
  const W = 1; // we use percentages, total = 100%
  let cursor = 0;
  state.shots.forEach((s, idx) => {
    const dur = Math.max(0.5, Number(s.duration) || 0);
    const left = (cursor / total) * 100;
    const width = (dur / total) * 100;
    cursor += dur;
    const isOver = s.duration > MAX_DURATION;
    const lc = state.insertWithLabelColors ? LABEL_CYCLE[idx % LABEL_CYCLE.length] : 0;
    const bg = isOver ? "rgba(239,68,68,0.6)" : (LABEL_HEX[lc] || "#5c7cfa") + "cc";
    // Status badge — single glyph in the corner of the segment so the user
    // can see at a glance which shots are queued / running / ready / failed
    // without scrolling down to the per-shot card.
    const statusGlyph = ({
      idle:    "",
      queued:  "⋯",
      running: "●",
      ready:   "✓",
      failed:  "✕"
    })[s.status] || "";
    const cls = "seg status-" + (s.status || "idle") +
                (state.selectedShotId === s.id ? " selected" : "");
    const titleParts = ["Shot " + s.index, dur + "s", "status: " + (s.status || "idle")];
    if (s.status === "running") titleParts.push("progress: " + (s.progress || 0) + "%");
    if (s.status === "failed" && s.error) titleParts.push("error: " + s.error);
    const seg = el("div", {
      class: cls,
      style: "left:" + left.toFixed(2) + "%; width:" + width.toFixed(2) + "%; background:" + bg + ";",
      title: titleParts.join(" · "),
      onClick: () => { state.selectedShotId = s.id; renderShotsOnly(); rebuildTimebar(); scrollToShot(s.id); }
    }, [
      el("span", { class: "seg-num" }, [String(s.index)]),
      statusGlyph ? el("span", { class: "seg-status-badge" }, [statusGlyph]) : null
    ]);
    // Live progress bar inside the running segment (a thin filled overlay)
    if (s.status === "running") {
      const pct = Math.max(5, Math.min(99, s.progress || 5));
      seg.appendChild(el("div", {
        class: "seg-progress",
        style: "width:" + pct + "%;"
      }));
    }
    wrap.appendChild(seg);
  });

  // 15s reference ticks
  const ticks = [];
  for (let t = 0; t <= total; t += 5) {
    const left = (t / total) * 100;
    const isMaj = (t % 15 === 0 && t > 0);
    ticks.push(el("div", { class: "tick" + (isMaj ? " major" : ""), style: "left:" + left + "%;" }));
    ticks.push(el("div", { class: "tick-label", style: "left:" + left + "%;" }, [t + "s"]));
  }
  ticks.forEach(t => wrap.appendChild(t));
  wrap.appendChild(el("div", { class: "legend" }, ["max 15s/clip · ticks every 5s"]));

  host.appendChild(wrap);
}

function renderShotsList() {
  const list = el("div", { class: "shots-wrap", id: "shots-host" });
  if (!state.shots.length) {
    list.appendChild(el("div", { class: "empty" }, [
      el("div", { class: "big" }, ["Empty storyboard"]),
      "Add a shot, sync from the AE work area, or ask the assistant to draft one."
    ]));
  } else {
    state.shots.forEach((s, i) => list.appendChild(renderShotCard(s, i)));
  }
  return list;
}

function renderShotsOnly() {
  // Re-render only the shots list and cost strip (cheaper than full render).
  const root = $("#root");
  if (!root) return;

  const oldCost = root.querySelector(".cost-strip");
  if (oldCost) oldCost.replaceWith(renderCostStrip());

  // Toolbar carries the live "Place ready clips (N)" counter — refresh it
  // when shot status changes, otherwise the count gets stale.
  const oldToolbar = root.querySelector(".toolbar");
  if (oldToolbar) oldToolbar.replaceWith(renderToolbar());

  const oldShots = $("#shots-host");
  if (oldShots) oldShots.replaceWith(renderShotsList());

  rebuildTimebar();
}

function scrollToShot(id) {
  const e = document.getElementById("shot-" + id);
  if (e) e.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderShotCard(s, i) {
  const isOver = s.duration > MAX_DURATION;
  const isSel  = state.selectedShotId === s.id;
  const lc = state.insertWithLabelColors ? LABEL_CYCLE[i % LABEL_CYCLE.length] : 0;
  const swatch = el("span", { class: "label-swatch", style: "background:" + (LABEL_HEX[lc] || "#52525b") });
  const cost = shotCostUSD(s);

  // Frame thumbnails (first / last)
  function frameBox(slot) {
    const data = s[slot];
    const placeholder = slot === "firstFrame" ? "First frame" : "Last frame (opt.)";
    const tag = slot === "firstFrame" ? "F1" : "F2";
    const refIndicator = (slot === "firstFrame" && refForShot(s))
      ? el("span", { class: "ref-dot",
          title: s.refOverride ? "Per-shot reference active (overrides global)" : "Global visual reference active" },
          [s.refOverride ? "📌" : "🔗"])
      : null;
    const children = [
      el("span", { class: "label mono" }, [tag]),
      refIndicator,
      data && data.dataUrl ? el("img", { src: data.dataUrl, alt: tag }) : el("span", null, [placeholder]),
      el("div", { class: "frame-actions" }, [
        el("button", { class: "ghost btn-sm", title: "Generate with Seedream (uses reference if set)",
          onClick: (e) => { e.stopPropagation(); generateFrameForShot(s, slot); } }, ["AI"]),
        data && data.dataUrl ? el("button", { class: "ghost btn-sm", title: "Edit this frame with a prompt (Seedream 5)",
          onClick: (e) => { e.stopPropagation(); editFrameForShot(s, slot); } }, ["✎"]) : null,
        el("button", { class: "ghost btn-sm", title: "Capture from AE playhead",
          onClick: (e) => { e.stopPropagation(); captureFrameForShot(s, slot); } }, ["AE"]),
        el("button", { class: "ghost btn-sm", title: "Upload from disk",
          onClick: (e) => { e.stopPropagation(); uploadFrameForShot(s, slot); } }, ["↑"]),
        data && data.dataUrl ? el("button", { class: "danger btn-sm", title: "Clear",
          onClick: (e) => { e.stopPropagation(); s[slot] = null; saveState(); renderShotsOnly(); } }, ["×"]) : null
      ])
    ];
    return el("div", {
      class: "frame" + (data && data.dataUrl ? " has-image" : ""),
      title: data && data.dataUrl ? "Click to view full size" : tag,
      onClick: (e) => {
        // Click on the thumbnail (not on its action buttons) → open lightbox
        if (data && data.dataUrl && !e.target.closest(".frame-actions")) {
          e.stopPropagation();
          openImageLightbox(data.dataUrl, {
            title:    "Shot " + s.index + " · " + (slot === "lastFrame" ? "last frame" : "first frame"),
            subtitle: (data.source || "") + (data.path ? "" : "  (not saved to disk)"),
            path:     data.path
          });
        }
      }
    }, children);
  }

  const refOverrideRow = el("div", { class: "ref-override-row" }, [
    s.refOverride
      ? el("div", { class: "kv mono", style: "font-size:10px; color:var(--purple);" }, [
          el("img", { src: s.refOverride.dataUrl, class: "ref-override-thumb",
            title: s.refOverride.label || "" }),
          "📌 per-shot ref",
          el("button", { class: "danger btn-sm", title: "Clear per-shot reference",
            onClick: () => { s.refOverride = null; saveState(); renderShotsOnly(); } }, ["×"])
        ])
      : el("button", { class: "ghost btn-sm", title: "Override global reference for this shot",
          onClick: () => uploadShotRefOverride(s) }, ["📌 ref override"])
  ]);

  const framesCol = el("div", null, [
    frameBox("firstFrame"),
    el("div", { style: "height:6px" }),
    frameBox("lastFrame"),
    el("div", { style: "height:6px" }),
    refOverrideRow
  ]);

  const body = el("div", { class: "body" }, [
    el("div", { class: "row" }, [
      el("div", { class: "kv mono", style: "min-width:60px;" }, [swatch, "#" + String(s.index).padStart(2, "0")]),
      el("span", { class: "status-pill " + s.status }, [statusLabel(s)]),
      s.chainFromPrev ? el("span", { class: "kv mono", style: "color:var(--emerald);" }, ["⇠ chained"]) : null,
      el("div", { style: "flex:1" }),
      el("button", { class: "ghost btn-sm", title: "Move up", onClick: () => moveShot(i, -1) }, ["↑"]),
      el("button", { class: "ghost btn-sm", title: "Move down", onClick: () => moveShot(i, 1) }, ["↓"]),
      el("button", { class: "ghost btn-sm", title: "Duplicate", onClick: () => duplicateShot(i) }, ["⎘"]),
      el("button", { class: "danger btn-sm", title: "Remove", onClick: () => removeShot(i) }, ["×"])
    ]),
    el("textarea", {
      placeholder: "Shot prompt — describe action, camera, mood…",
      onInput: (e) => { s.prompt = e.target.value; saveState(); updateShotMetaUI(s); },
      value: s.prompt
    }, [s.prompt || ""]),
    el("div", { class: "meta" }, [
      (() => {
        const sel = el("select", {
          title: "Video model for THIS shot (overrides global default)",
          onChange: (e) => { s.model = e.target.value || null; saveState(); renderShotsOnly(); }
        }, [
          (() => { const o = el("option", { value: "" }, ["⚙ default"]); if (!s.model) o.setAttribute("selected","selected"); return o; })(),
          ...Object.keys(VIDEO_MODELS).map(k => {
            const m = VIDEO_MODELS[k];
            const o = el("option", { value: k }, [m.label + "  ($" + m.pricePerM.toFixed(2) + "/M)"]);
            if (s.model === k) o.setAttribute("selected","selected");
            return o;
          })
        ]);
        return sel;
      })(),
      (() => {
        const sel = el("select", {
          title: "Resolution",
          onChange: (e) => { s.resolution = e.target.value; saveState(); renderShotsOnly(); }
        }, Object.keys(RES_PX).map(k => {
          const o = el("option", { value: k }, [k + "  " + RES_PX[k].w + "×" + RES_PX[k].h]);
          if (k === s.resolution) o.setAttribute("selected","selected");
          return o;
        }));
        return sel;
      })(),
      (() => {
        const sel = el("select", {
          title: "Aspect ratio",
          onChange: (e) => { s.aspect = e.target.value; saveState(); }
        }, ASPECTS.map(a => {
          const o = el("option", { value: a }, [a]);
          if (a === s.aspect) o.setAttribute("selected","selected");
          return o;
        }));
        return sel;
      })(),
      el("label", { class: "kv mono", title: "Generate audio (Seedance 2.0)" }, [
        el("input", { type: "checkbox", checked: s.generateAudio, onChange: (e) => { s.generateAudio = e.target.checked; saveState(); } }),
        "audio"
      ]),
      el("label", { class: "kv mono", title: "Camera fixed (no motion)" }, [
        el("input", { type: "checkbox", checked: s.cameraFixed, onChange: (e) => { s.cameraFixed = e.target.checked; saveState(); } }),
        "fixed cam"
      ]),
      el("label", { class: "kv mono", title: "Tell Seedance to return the last frame (use for chaining the next shot)" }, [
        el("input", { type: "checkbox", checked: s.returnLastFrame, onChange: (e) => { s.returnLastFrame = e.target.checked; saveState(); } }),
        "return last frame"
      ]),
      el("span", { class: "chip mono" }, [shotTokens(s).toLocaleString() + " tok"])
    ]),
    el("div", { class: "shot-actions" }, [
      el("button", { class: "primary btn-sm", disabled: s.status === "running" || isOver,
        title: isOver ? "Over 15s — split this shot" : ("Generate this shot — " + fmtMoney(cost)),
        onClick: () => runBatch([s]) }, ["▶ Generate · " + fmtMoney(cost)]),
      s.status === "ready" && s.videoPath ? el("button", { class: "teal btn-sm", title: "Open output folder",
        onClick: () => openInExplorer(s.videoPath) }, ["📁 Open"]) : null,
      s.status === "ready" && s.videoPath && AEBridge.isInAE() ? el("button", { class: "ghost btn-sm",
        onClick: () => placeReadyShotsIntoAE([s]) }, ["⤴ Place in AE"]) : null,
      s.status === "ready" && s.videoPath ? el("button", { class: "amber btn-sm", title: "Use last frame as start of next shot",
        onClick: () => chainToNext(s) }, ["⇨ Chain to next"]) : null,
      s.error ? el("span", { class: "kv", style: "color:var(--red); font-size:10px;" }, ["⚠ " + s.error]) : null,
      s.note ? el("span", { class: "kv", style: "color:var(--text-faint); font-size:10px;" }, [s.note]) : null
    ])
  ]);

  // Right column: duration slider + cost
  const durationCol = el("div", { class: "duration" }, [
    el("div", { class: "val" + (isOver ? " over" : "") }, [Number(s.duration).toFixed(1) + "s"]),
    el("input", {
      type: "range", min: String(MIN_DURATION), max: String(MAX_DURATION), step: "1", value: s.duration,
      onInput: (e) => {
        s.duration = parseInt(e.target.value, 10);
        // live update val + cost without full re-render
        const card = e.target.closest(".shot");
        if (card) {
          const v = card.querySelector(".duration .val");
          const c = card.querySelector(".duration .cost");
          if (v) v.textContent = s.duration + "s";
          if (c) c.textContent = fmtMoney(shotCostUSD(s));
        }
      },
      onChange: () => { saveState(); rebuildTimebar(); refreshCostStripOnly(); }
    }),
    el("div", { class: "sub" }, [MIN_DURATION + "–" + MAX_DURATION + "s · integer"]),
    el("div", { class: "cost" }, [fmtMoney(cost)])
  ]);

  const card = el("div", {
    id: "shot-" + s.id,
    class: "shot" + (isSel ? " selected" : "") + (isOver ? " over15" : ""),
    onClick: () => { state.selectedShotId = s.id; rebuildTimebar(); $$(".shot").forEach(c => c.classList.remove("selected")); card.classList.add("selected"); }
  }, [
    el("span", { class: "badge-num" }, ["#" + String(s.index).padStart(2, "0")]),
    framesCol,
    body,
    durationCol,
    state.chainAll && i < state.shots.length - 1 ? el("div", { class: "arrow-link active", title: "Last frame chains to next shot" }, ["⇣"]) : null
  ]);
  return card;
}

function statusLabel(s) {
  switch (s.status) {
    case "queued":  return "queued";
    case "running": return "rendering " + (s.progress || 0) + "%";
    case "ready":   return "ready";
    case "failed":  return "failed";
    default:        return "idle";
  }
}

function refreshCostStripOnly() {
  const oldCost = $(".cost-strip");
  if (oldCost) oldCost.replaceWith(renderCostStrip());
}

function updateShotMetaUI(s) {
  // Light-touch update for prompts (don't full-rerender on every keystroke).
}

/* ----------------------------- Shot ops --------------------------------- */

function addShot() {
  state.shots.push(defaultShot(state.shots.length + 1));
  reindex(); saveState(); render();
}
function removeShot(i) {
  if (!confirm("Remove shot " + (i + 1) + "?")) return;
  state.shots.splice(i, 1);
  reindex(); saveState(); render();
}
function duplicateShot(i) {
  const copy = JSON.parse(JSON.stringify(state.shots[i]));
  copy.id = "s" + Date.now() + "_" + Math.random().toString(36).slice(2,7);
  copy.status = "idle"; copy.taskId = null; copy.videoPath = null; copy.videoUrl = null; copy.error = null;
  state.shots.splice(i + 1, 0, copy);
  reindex(); saveState(); render();
}
function moveShot(i, dir) {
  const ni = i + dir;
  if (ni < 0 || ni >= state.shots.length) return;
  const tmp = state.shots[i]; state.shots[i] = state.shots[ni]; state.shots[ni] = tmp;
  reindex(); saveState(); render();
}
async function chainToNext(s) {
  const idx = state.shots.findIndex(x => x.id === s.id);
  if (idx < 0 || idx >= state.shots.length - 1) { toast("This is the last shot — add another first.", "info"); return; }
  if (!s.videoPath) { toast("Generate this shot first.", "error"); return; }
  try {
    const lf = await extractLastFrameDataUrl(s.videoPath);
    state.shots[idx + 1].firstFrame = { dataUrl: lf, width: 0, height: 0, source: "chain" };
    state.shots[idx + 1].chainFromPrev = true;
    saveState(); renderShotsOnly();
    toast("Chained shot " + s.index + " → " + (s.index + 1), "success");
  } catch (e) { toast("Chain failed: " + e.message, "error"); }
}

/* ----------------------------- Frame inputs ----------------------------- */

/** Resolve which reference image (if any) should be used when generating a
 *  frame for this shot. Per-shot override beats the global. */
function refForShot(shot) {
  if (shot.refOverride && shot.refOverride.dataUrl) return shot.refOverride;
  if (state.visualReference && state.visualReference.dataUrl) return state.visualReference;
  return null;
}

/** Build the effective Seedream prompt for a frame. When a reference image
 *  is being used we add a directive that anchors the model to the
 *  character/setting captured in the reference. */
function framePromptFor(shot, slot, ref) {
  const base = (shot.prompt || "").trim();
  const tail = (slot === "lastFrame") ? " · final pose, end of motion" : "";
  if (!ref) return base + tail;
  return anchorPrefix(state.refMode) + "\n\n" + base + tail;
}

async function generateFrameForShot(s, slot) {
  const prompt = (s.prompt || "").trim();
  if (!prompt) { toast("Write a prompt first.", "error"); return; }
  const ref = refForShot(s);
  log.info("Frame · shot " + s.index + " · generating " + slot + (ref ? " (with reference)" : " (text-only)"));
  toast("Generating " + slot + "…", "info");
  try {
    const url = ref
      ? await seedreamWithReference(ref.dataUrl, framePromptFor(s, slot, ref))
      : await seedreamGenerate(framePromptFor(s, slot, null), { aspect: s.aspect });
    let savedPath = null;
    try {
      savedPath = await saveImageAsset(url,
        "shot-" + String(s.index).padStart(2, "0") + "-" + (slot === "lastFrame" ? "last" : "first"));
      log.ok("Frame · saved to " + savedPath);
    } catch (eSave) { log.warn("Frame · could not save to disk: " + eSave.message); }
    s[slot] = { dataUrl: url, path: savedPath, width: 0, height: 0, source: ref ? "generated-ref" : "generated" };
    saveState(); renderShotsOnly();
    toast(slot + " generated.", "success");
  } catch (e) { toast("Seedream error: " + e.message, "error"); log.error("Frame · shot " + s.index + " · " + e.message); }
}

/** Edit an existing frame in place: takes the current image + a user prompt
 *  describing the desired change, returns a Seedream-5 modification. */
async function editFrameForShot(s, slot) {
  const data = s[slot];
  if (!data || !data.dataUrl) { toast("No frame to edit yet.", "error"); return; }
  const editPrompt = window.prompt(
    "Describe the change to apply to this frame. (Same character/setting will be preserved.)\n\nExamples: \"add rim lighting\", \"change to night-time scene\", \"camera moved to low angle\"."
  );
  if (!editPrompt || !editPrompt.trim()) return;
  log.info("Frame · shot " + s.index + " · editing " + slot + " — \"" + editPrompt.slice(0, 50) + "\"");
  try {
    const url = await seedreamWithReference(data.dataUrl, editPrompt.trim());
    let savedPath = null;
    try {
      savedPath = await saveImageAsset(url,
        "shot-" + String(s.index).padStart(2, "0") + "-" + (slot === "lastFrame" ? "last" : "first") + "-edit-" + Date.now().toString(36));
      log.ok("Frame · edit saved to " + savedPath);
    } catch (eSave) { log.warn("Frame · could not save edit: " + eSave.message); }
    s[slot] = { dataUrl: url, path: savedPath, width: 0, height: 0, source: "edit" };
    saveState(); renderShotsOnly();
    toast("Frame edited.", "success");
  } catch (e) { toast("Edit failed: " + e.message, "error"); log.error("Frame edit · " + e.message); }
}

/** Batch-generate the missing first-frames for every shot in the storyboard.
 *  Honours the visual reference (global or per-shot) and runs with bounded
 *  concurrency. Skips shots that already have a first-frame unless `force`
 *  is true. */
async function generateAllFirstFrames(force) {
  const targets = state.shots.filter(s =>
    (s.prompt || "").trim() && (force || !s.firstFrame || !s.firstFrame.dataUrl)
  );
  if (!targets.length) {
    toast(force ? "No shots with prompts." : "All shots already have a first frame.", "info");
    return;
  }
  log.info("Frame batch · " + targets.length + " shot(s) · concurrency " + FRAME_BATCH_CONCURRENCY +
           (state.visualReference ? " · global reference active" : " · no global reference"));
  const t0 = Date.now();
  let cursor = 0;
  let okN = 0, failN = 0;
  const workers = Array.from({ length: Math.min(FRAME_BATCH_CONCURRENCY, targets.length) }, async () => {
    while (cursor < targets.length) {
      const s = targets[cursor++];
      try {
        const ref = refForShot(s);
        const url = ref
          ? await seedreamWithReference(ref.dataUrl, framePromptFor(s, "firstFrame", ref))
          : await seedreamGenerate(framePromptFor(s, "firstFrame", null), { aspect: s.aspect });
        let savedPath = null;
        try { savedPath = await saveImageAsset(url, "shot-" + String(s.index).padStart(2, "0") + "-first"); }
        catch (eSave) { log.warn("Frame batch · save failed shot " + s.index + ": " + eSave.message); }
        s.firstFrame = { dataUrl: url, path: savedPath, width: 0, height: 0, source: ref ? "generated-ref" : "generated" };
        okN++;
        renderShotsOnly();
      } catch (e) {
        failN++;
        log.error("Frame batch · shot " + s.index + " failed: " + e.message);
      }
    }
  });
  await Promise.all(workers);
  saveState();
  renderShotsOnly();
  log.ok("Frame batch · finished in " + ((Date.now() - t0) / 1000).toFixed(1) + "s · " +
         okN + " ready · " + failN + " failed");
  toast("Generated " + okN + " frame(s)" + (failN ? " (" + failN + " failed)" : "") + ".", failN ? "error" : "success");
}

/** Set / clear the global visual reference. Persists to disk when set. */
async function setVisualReference(dataUrl, label, source) {
  if (!dataUrl) {
    state.visualReference = null;
    log.info("Visual reference cleared.");
  } else {
    let savedPath = null;
    try { savedPath = await saveImageAsset(dataUrl, "visual-reference", "reference"); log.ok("Visual reference saved to " + savedPath); }
    catch (e) { log.warn("Visual reference · could not save to disk: " + e.message); }
    state.visualReference = {
      dataUrl: dataUrl, path: savedPath,
      label: label || "reference", source: source || "upload"
    };
    log.ok("Visual reference set (" + (source || "upload") + ") — frames generated from now on will inherit it.");
  }
  saveState(); render();
}

async function generateVisualReference() {
  const promptTxt = window.prompt(
    "Describe the character / setting / product / logo that should stay consistent across all shots.\n\n" +
    "Examples: \"a young woman with dark curly hair, leather jacket, late-twenties\" · " +
    "\"a sunlit modern kitchen with marble counters and brass fittings\" · " +
    "\"a glossy red lipstick tube with gold cap, brand logo on the side\""
  );
  if (!promptTxt || !promptTxt.trim()) return;
  toast("Generating visual reference…", "info");
  try {
    // Use the AE comp's aspect when present so the reference matches what
    // Seedance will render; fall back to 1:1 (works with any later aspect).
    const refAspect = (aeStatus && aeStatus.aspect) || "1:1";
    const url = await seedreamGenerate(promptTxt.trim(), { aspect: refAspect });
    await setVisualReference(url, promptTxt.slice(0, 60), "generated");
  } catch (e) { toast("Reference gen failed: " + e.message, "error"); }
}

function uploadVisualReference() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*";
  inp.onchange = (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => setVisualReference(fr.result, f.name, "upload");
    fr.readAsDataURL(f);
  };
  inp.click();
}

function uploadShotRefOverride(shot) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*";
  inp.onchange = (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      shot.refOverride = { dataUrl: fr.result, label: f.name };
      saveState(); renderShotsOnly();
      log.ok("Shot " + shot.index + " · per-shot reference set (overrides global)");
    };
    fr.readAsDataURL(f);
  };
  inp.click();
}

async function captureFrameForShot(s, slot) {
  if (!AEBridge.isInAE()) { toast("Not running inside AE.", "error"); return; }
  try {
    const dir = await framesDir();
    if (!dir) { toast("Could not resolve frames folder.", "error"); return; }
    const path = nodeRequire("path");
    const target = path.join(dir, "capture-shot" + String(s.index).padStart(2, "0") + "-" + slot + "-" + Date.now() + ".png");
    const r = await AEBridge.captureFrameToFile(target);
    if (!r || r.error) throw new Error(r?.error || "Capture failed");
    const du = await readFileAsDataUrl(r.path || target);
    s[slot] = { dataUrl: du, width: r.width || 0, height: r.height || 0, source: "capture" };
    saveState(); renderShotsOnly();
    toast(slot + " captured from AE.", "success");
  } catch (e) { toast("Capture error: " + e.message, "error"); }
}

function uploadFrameForShot(s, slot) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*";
  inp.onchange = (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      s[slot] = { dataUrl: fr.result, width: 0, height: 0, source: "upload" };
      saveState(); renderShotsOnly();
    };
    fr.readAsDataURL(f);
  };
  inp.click();
}

/* ----------------------------- Assistant -------------------------------- */

async function assistantSubmit() {
  const msg = (assistantInput || "").trim();
  if (!msg) return;
  assistantInput = "";
  assistantHistory.push({ role: "user", content: msg });
  render();
  try {
    const reply = await glmAssist(msg, assistantHistory.slice(0, -1));
    assistantHistory.push({ role: "assistant", content: reply });

    // Try to parse a JSON shot list out of the reply
    const shots = parseShotsFromReply(reply);
    if (shots && shots.length) {
      const replace = state.shots.length === 1 && !state.shots[0].prompt;
      const newShots = shots.map((sh, i) => {
        const s = defaultShot(i + 1);
        s.prompt = sh.prompt || "";
        s.duration = clampDuration(Number(sh.duration) || DEFAULT_DURATION);
        // Keep both camera and note visible — camera goes into the note line
        // for quick reference under the prompt textarea.
        const parts = [];
        if (sh.camera) parts.push("📷 " + sh.camera);
        if (sh.note)   parts.push(sh.note);
        s.note = parts.length ? parts.join(" · ") : null;
        return s;
      });
      state.shots = replace ? newShots : state.shots.concat(newShots);
      reindex();
      log.ok("Assistant · imported " + newShots.length + " shot(s)" +
             (replace ? " (replaced empty storyboard)" : " (appended)"));
    } else {
      log.warn("Assistant · reply did not contain a parsable shot list — left storyboard unchanged.");
    }
    saveState();
    render();
  } catch (e) {
    toast("Assistant error: " + e.message, "error");
  }
}
function assistantClear() { assistantHistory = []; render(); }

function parseShotsFromReply(txt) {
  if (!txt) return null;
  // Extract first {...} block
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (obj && Array.isArray(obj.shots)) return obj.shots;
  } catch (e) {}
  return null;
}

/* ----------------------------- AE integration helpers ------------------- */

async function refreshAEStatus() {
  const prev = JSON.stringify(aeStatus);
  if (!AEBridge.isInAE()) {
    aeStatus = { ready: false, compName: "", width: 0, height: 0, frameRate: 0, aspect: null, resolution: null };
  } else {
    try {
      const r = await AEBridge.checkReady();
      const ready = !!(r && r.hasActiveComp);
      let info = null;
      if (ready) {
        try { info = await AEBridge.getActiveCompInfo(); } catch (e) { info = null; }
      }
      const w = info?.width  || 0;
      const h = info?.height || 0;
      aeStatus = {
        ready:      ready,
        compName:   r?.activeCompName || (info?.name || ""),
        width:      w,
        height:     h,
        frameRate:  info?.frameRate || 0,
        aspect:     aspectFromDimensions(w, h),
        resolution: resolutionFromHeight(h)
      };
    } catch (e) {
      aeStatus = { ready: false, compName: "", width: 0, height: 0, frameRate: 0, aspect: null, resolution: null };
    }
  }
  // Only touch the DOM if status actually changed — avoid wiping focus,
  // selection, scroll position and unbound input values (e.g. the assistant
  // textarea while the user is typing).
  if (JSON.stringify(aeStatus) === prev) return;
  // Comp name (or any input feeding the save root) just changed — drop
  // the dir cache so subsequent saves go to the right project folder.
  resetAssetDirCache();
  const oldTop = document.querySelector(".topbar");
  if (oldTop) oldTop.replaceWith(renderTopBar());
}

async function insertPlaceholdersInAE() {
  if (!AEBridge.isInAE()) { toast("Not running inside AE.", "error"); return; }
  const usable = state.shots.filter(s => s.firstFrame && s.firstFrame.dataUrl);
  if (!usable.length) { toast("No first-frame images yet — generate or upload them first.", "info"); return; }

  // Save first-frame data URLs to disk so AE can import them
  const dir = await framesDir();
  if (!dir) { toast("Could not resolve frames folder.", "error"); return; }
  const path = nodeRequire("path");

  let cursor = 0;
  const payload = [];
  for (const s of usable) {
    const m = (s.firstFrame.dataUrl.match(/^data:([^;]+);base64,(.+)$/) || []);
    const ext = (m[1] || "image/png").indexOf("jpeg") >= 0 ? "jpg" : "png";
    const out = path.join(dir, "preview-shot" + String(s.index).padStart(2, "0") + "." + ext);
    writeBase64ToFile(m[2] || "", out);
    payload.push({
      shotIndex:    s.index,
      path:         out,
      label:        ("shot-" + String(s.index).padStart(2, "0")),
      prompt:       s.prompt,
      startTime:    cursor,
      durationHint: clampDuration(s.duration),
      labelColor:   state.insertWithLabelColors ? LABEL_CYCLE[(s.index - 1) % LABEL_CYCLE.length] : 0,
      marker:       state.insertWithMarkers
    });
    cursor += clampDuration(s.duration);
  }

  // Stretch the work area to fit
  try {
    const wa = await AEBridge.getWorkAreaInfo();
    if (wa && wa.success) await AEBridge.setWorkArea(wa.workAreaStart, Math.max(wa.workAreaDuration, cursor));
  } catch (e) {}

  // Don't auto-flip state.placeholderMode here. Auto-place after a video
  // generation must always do DIRECT placement unless the user explicitly
  // toggles "Use placeholder workflow" in Settings — otherwise a single
  // Preview-in-AE click would silently break every subsequent generation.
  try {
    const r = await AEBridge.insertStoryboardPlaceholders(payload, true);
    if (r && r.error) throw new Error(r.error);
    toast("Inserted " + (r.results?.length || 0) + " placeholders. Move them in AE, then click Generate all.", "success");
  } catch (e) { toast("Insert failed: " + e.message, "error"); }
}

function openInExplorer(filePath) {
  try {
    const cep = (window.cep && window.cep.process) || null;
    if (cep) {
      // Best-effort: just spawn explorer /select,
      cep.createProcess("explorer", "/select,", filePath);
    } else {
      // Fallback for non-CEP env
      window.open("file:///" + filePath.replace(/\\/g, "/"));
    }
  } catch (e) {}
}

/* ----------------------------- Settings modal --------------------------- */

function openSettingsModal() {
  const host = $("#modal-host");
  host.innerHTML = "";
  const close = () => { host.innerHTML = ""; };

  const arkInp = el("input", { type: "password", placeholder: "ARK API key (used by Seedance + Seedream)", value: arkKey() });
  const zaiInp = el("input", { type: "password", placeholder: "Z.AI API key (GLM assistant)",                value: zaiKey() });
  const dirInp = el("input", { type: "text", placeholder: "Output directory…", value: outputDir() });
  const modSel = el("select", null, Object.keys(VIDEO_MODELS).map(k =>
    el("option", { value: k, selected: (localStorage.getItem(LS.MOD) || "standard") === k ? "" : null },
      [VIDEO_MODELS[k].label + "  ($" + VIDEO_MODELS[k].pricePerM.toFixed(2) + "/M tok)"])
  ));
  const markersChk = el("input", { type: "checkbox", checked: state.insertWithMarkers });
  const colorsChk  = el("input", { type: "checkbox", checked: state.insertWithLabelColors });

  const back = el("div", { class: "modal-back", onClick: (e) => { if (e.target === back) close(); } }, [
    el("div", { class: "modal" }, [
      el("div", { class: "head" }, [
        el("h3", null, ["Storyboarder settings"]),
        el("button", { class: "ghost btn-sm", onClick: close }, ["×"])
      ]),
      el("div", { class: "body" }, [
        el("div", { class: "hint" }, [
          "API keys are shared with the main Seedance Studio panel (same localStorage). Set them in either panel."
        ]),
        el("label", { class: "field" }, ["BytePlus ARK key"]), arkInp,
        el("label", { class: "field" }, ["Z.AI key (GLM)"]),  zaiInp,
        el("label", { class: "field" }, ["Output directory"]), dirInp,
        el("label", { class: "field" }, ["Seedance video model"]), modSel,
        el("div", { class: "divider" }),
        el("label", { class: "kv" }, [markersChk, "Add comp marker at each shot start (with prompt as comment)"]),
        el("label", { class: "kv" }, [colorsChk,  "Color-code layers with rotating AE label colors"])
      ]),
      el("div", { class: "foot" }, [
        el("button", { class: "ghost", onClick: close }, ["Cancel"]),
        el("button", { class: "primary", onClick: () => {
          localStorage.setItem(LS.ARK, arkInp.value.trim());
          localStorage.setItem(LS.ZAI, zaiInp.value.trim());
          localStorage.setItem(LS.OUT, dirInp.value.trim() || defaultOutputDir());
          localStorage.setItem(LS.MOD, modSel.value);
          state.insertWithMarkers     = markersChk.checked;
          state.insertWithLabelColors = colorsChk.checked;
          saveState();
          saveSharedConfig();   // mirror to disk so settings survive reloads
          log.ok("Settings saved · ARK=" + (arkInp.value ? "set" : "empty") +
                 " · Z.AI=" + (zaiInp.value ? "set" : "empty") +
                 " · model=" + modSel.value);
          close();
          render();
          toast("Settings saved.", "success");
        }}, ["Save"])
      ])
    ])
  ]);
  host.appendChild(back);
}

/* ----------------------------- Boot ------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  // Pull keys/output dir from the shared config file before we render so
  // the missing-key banner reflects the true state.
  const restored = loadSharedConfig();
  render();
  if (restored) log.ok("Settings restored from shared config file.");
  log.info("Storyboarder ready. " + (missingKeys().length
    ? ("Missing keys: " + missingKeys().join(", ") + ". Open Settings (⚙).")
    : "API keys loaded."));
  refreshAEStatus();
  // Re-poll AE status every 4s so the top bar stays current
  setInterval(refreshAEStatus, 4000);
});

})();
