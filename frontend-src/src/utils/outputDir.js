/**
 * Output directory resolution.
 *
 * Priority:
 *   1. Folder of the currently saved AE project  → <project_dir>/Seedance/<type>/
 *   2. User setting (localStorage "seedance_output_dir")  → <setting>/<type>/
 *   3. ~/Seedance/<type>/
 *
 * type: any short subdirectory name — "video", "image", "snapshot", "media", "audio", etc.
 *       Anything not a-z0-9_- is sanitized to "media" to avoid traversal issues.
 */

function getNodeRequire() {
  if (typeof window !== "undefined" && typeof window.require === "function") return window.require;
  if (typeof require === "function") return require;
  return null;
}

function defaultBaseDir() {
  const r = getNodeRequire();
  if (!r) return "";
  try {
    return r("path").join(r("os").homedir(), "Seedance");
  } catch (_) {
    return "";
  }
}

function nodePath(parts) {
  const r = getNodeRequire();
  if (!r) return parts.join("/");
  try { return r("path").join(...parts); } catch (_) { return parts.join("/"); }
}

function ensureDir(dir) {
  if (!dir) return dir;
  const r = getNodeRequire();
  if (!r) return dir;
  try {
    const fs = r("fs");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  return dir;
}

/**
 * Returns the resolved output directory for the given type, creating it if needed.
 * Always call this async — it may query AE for the project path.
 */
export async function getOutputDir(type) {
  // Sanitize: only allow simple folder-name characters, default to "media".
  const safe = (typeof type === "string" && /^[a-z0-9_-]{1,32}$/i.test(type)) ? type : "media";

  // 1. Try AE project folder. We nest under a "Seedance" parent so the project
  //    folder isn't polluted with bare video/image/snapshot subdirs.
  if (
    typeof window !== "undefined" &&
    typeof window.AEBridge !== "undefined" &&
    window.AEBridge.isInAfterEffects()
  ) {
    try {
      const res = await window.AEBridge.getProjectDir();
      if (res && res.path) {
        return ensureDir(nodePath([res.path, "Seedance", safe]));
      }
    } catch (_) {}
  }

  // 2. User settings / default
  const base = localStorage.getItem("seedance_output_dir") || defaultBaseDir();
  return ensureDir(nodePath([base, safe]));
}

/**
 * Save a base64 data URL as a JPEG/PNG file in the given directory.
 * Returns the absolute file path, or null if Node.js is unavailable.
 */
export function saveDataUrlToDisk(dataUrl, dir, filename) {
  const r = getNodeRequire();
  if (!r || !dir) return null;
  try {
    const fs   = r("fs");
    const path = r("path");
    ensureDir(dir);
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buf    = Buffer.from(base64, "base64");
    const fp     = path.join(dir, filename);
    fs.writeFileSync(fp, buf);
    return fp;
  } catch (_) {
    return null;
  }
}

/**
 * Timestamp string for filenames: YYYYMMDD_HHmmss
 */
export function makeTimestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}
