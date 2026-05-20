/**
 * Download a remote MP4 to disk via Node.js https (bypasses browser CORS).
 * Returns the absolute path of the saved file.
 */
import { getOutputDir, makeTimestamp } from "./outputDir.js";

function getNodeRequire() {
  if (typeof window !== "undefined" && typeof window.require === "function") return window.require;
  if (typeof require === "function") return require;
  return null;
}

export async function downloadVideoToOutput(videoUrl, {
  subdir  = "video",
  prefix  = "seedance",
} = {}) {
  const _require = getNodeRequire();
  if (!_require) {
    throw new Error("Node.js (require) not available. Check manifest --enable-nodejs flag.");
  }

  const fs    = _require("fs");
  const https = _require("https");
  const http  = _require("http");
  const path  = _require("path");

  const outputDir = await getOutputDir(subdir);
  if (!outputDir) throw new Error("Output folder not set. Configure it in Settings.");

  const filePath   = path.join(outputDir, `${prefix}_${makeTimestamp()}.mp4`);
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
