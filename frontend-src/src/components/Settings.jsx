import { useState, useEffect } from "react";

const LS_ARK      = "seedance_ark_key";
const LS_ZAI      = "seedance_zai_key";
const LS_FAL      = "seedance_fal_key";
const LS_ALIBABA  = "seedance_alibaba_key";    // Alibaba Cloud Model Studio (DashScope) API key — for HappyHorse
const LS_HH_REGION = "seedance_hh_region";     // singapore | beijing | us-virginia | hk | germany
const LS_OUT      = "seedance_output_dir";
const LS_MODEL    = "seedance_model";
const LS_AUTOHOST = "seedance_auto_host";  // "1" = auto-upload to tmpfiles, "0" = save locally

// Per the official Alibaba Cloud Model Studio docs ("Get an API key.md"),
// each region has its own DashScope endpoint. The model + endpoint + key
// must all belong to the same region.
const ALIBABA_REGIONS = [
  { id: "singapore",   label: "Singapore (default)",          base: "https://dashscope-intl.aliyuncs.com" },
  { id: "beijing",     label: "China — Beijing",              base: "https://dashscope.aliyuncs.com" },
  { id: "us-virginia", label: "US — Virginia",                base: "https://dashscope-us.aliyuncs.com" },
  { id: "hk",          label: "China — Hong Kong",            base: "https://cn-hongkong.dashscope.aliyuncs.com" },
];

const MODEL_OPTIONS = [
  {
    id:    "standard",
    label: "Seedance 2.0 Standard",
    id_str: "dreamina-seedance-2-0-260128",
    price: "$7.00/M tokens",
    desc:  "Best quality, full capability",
  },
  {
    id:    "fast",
    label: "Seedance 2.0 Fast",
    id_str: "dreamina-seedance-2-0-fast-260128",
    price: "$5.60/M tokens",
    desc:  "Faster generation, slightly lower cost",
  },
];
// Note: Seedance 1.5 Pro has its own tab in the header with a tailored UI
// (supports 1080p, no omni-reference mode). It does not belong in this
// 2.0-only model switch.

function openExternal(e) {
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

function getDefaultOutputDir() {
  if (typeof require !== "undefined") {
    try {
      const os   = require("os");
      const path = require("path");
      return path.join(os.homedir(), "Seedance");
    } catch (_) {}
  }
  return "";
}

export default function Settings({ onOpenAssetHelper }) {
  const [arkKey,     setArkKey]     = useState("");
  const [zaiKey,     setZaiKey]     = useState("");
  const [falKey,     setFalKey]     = useState("");
  const [alibabaKey, setAlibabaKey] = useState("");
  const [hhRegion,   setHhRegion]   = useState("singapore");
  const [outputDir,  setOutputDir]  = useState("");
  const [model,      setModel]      = useState("standard");
  const [autoHost,   setAutoHost]   = useState(true);
  const [showArk,    setShowArk]    = useState(false);
  const [showZai,    setShowZai]    = useState(false);
  const [showFal,    setShowFal]    = useState(false);
  const [showAli,    setShowAli]    = useState(false);
  const [saved,      setSaved]      = useState(false);

  useEffect(() => {
    setArkKey(localStorage.getItem(LS_ARK) || "");
    setZaiKey(localStorage.getItem(LS_ZAI) || "");
    setFalKey(localStorage.getItem(LS_FAL) || "");
    setAlibabaKey(localStorage.getItem(LS_ALIBABA) || "");
    setHhRegion(localStorage.getItem(LS_HH_REGION) || "singapore");
    setOutputDir(localStorage.getItem(LS_OUT) || getDefaultOutputDir());
    setModel(localStorage.getItem(LS_MODEL) || "standard");
    const ah = localStorage.getItem(LS_AUTOHOST);
    setAutoHost(ah === null ? true : ah === "1");
  }, []);

  const handleSave = () => {
    localStorage.setItem(LS_ARK,       arkKey.trim());
    localStorage.setItem(LS_ZAI,       zaiKey.trim());
    localStorage.setItem(LS_FAL,       falKey.trim());
    localStorage.setItem(LS_ALIBABA,   alibabaKey.trim());
    localStorage.setItem(LS_HH_REGION, hhRegion);
    localStorage.setItem(LS_OUT,       outputDir.trim() || getDefaultOutputDir());
    localStorage.setItem(LS_MODEL,     model);
    localStorage.setItem(LS_AUTOHOST,  autoHost ? "1" : "0");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6 py-2">

      {/* API Keys */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-200 mb-1">API Keys</h2>
        <p className="text-xs text-zinc-500 mb-4">
          Stored locally — never sent anywhere except the respective API endpoints.
        </p>

        <div className="space-y-3">
          {/* ARK key */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">
              BytePlus ARK API Key{" "}
              <span className="text-zinc-600 font-normal">(required for generation)</span>
            </label>
            <div className="relative">
              <input
                type={showArk ? "text" : "password"}
                value={arkKey}
                onChange={(e) => setArkKey(e.target.value)}
                placeholder="Enter your ARK API key..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 pr-10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500 font-mono"
              />
              <button
                onClick={() => setShowArk((v) => !v)}
                className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300 transition"
                title={showArk ? "Hide" : "Show"}
              >
                {showArk ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-[10px] text-zinc-600">
              Get your key at{" "}
              <span className="text-brand-400">console.byteplus.com → ModelArk → API Keys</span>
            </p>
          </div>

          {/* Z.AI key */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">
              Z.AI API Key{" "}
              <span className="text-zinc-600 font-normal">(optional — Prompt Assistant)</span>
            </label>
            <div className="relative">
              <input
                type={showZai ? "text" : "password"}
                value={zaiKey}
                onChange={(e) => setZaiKey(e.target.value)}
                placeholder="Enter your Z.AI API key..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 pr-10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500 font-mono"
              />
              <button
                onClick={() => setShowZai((v) => !v)}
                className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300 transition"
              >
                {showZai ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-[10px] text-zinc-600">
              Get your key at <span className="text-brand-400">api.z.ai</span>
            </p>
          </div>

          {/* fal.ai key */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">
              fal.ai API Key{" "}
              <span className="text-zinc-600 font-normal">(optional — Depth Map generation)</span>
            </label>
            <div className="relative">
              <input
                type={showFal ? "text" : "password"}
                value={falKey}
                onChange={(e) => setFalKey(e.target.value)}
                placeholder="Enter your fal.ai API key..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 pr-10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500 font-mono"
              />
              <button
                onClick={() => setShowFal((v) => !v)}
                className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300 transition"
              >
                {showFal ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-[10px] text-zinc-600">
              Used to generate depth-map versions of reference videos (bypasses BytePlus real-person block).
              Get your key at <span className="text-brand-400">fal.ai/dashboard/keys</span>
            </p>
          </div>

          {/* Alibaba Cloud Model Studio (DashScope) — for HappyHorse video models.
              Per docs: model + endpoint + key must all belong to the SAME region.
              Default region is Singapore (ap-southeast-1). */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">
              Alibaba Cloud Model Studio API Key{" "}
              <span className="text-zinc-600 font-normal">(required for HappyHorse)</span>
            </label>
            <div className="relative">
              <input
                type={showAli ? "text" : "password"}
                value={alibabaKey}
                onChange={(e) => setAlibabaKey(e.target.value)}
                placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 pr-10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500 font-mono"
              />
              <button
                onClick={() => setShowAli((v) => !v)}
                className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300 transition"
                title={showAli ? "Hide" : "Show"}
              >
                {showAli ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>

            {/* Region selector — required because endpoint URL depends on it */}
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-zinc-500">Region</label>
              <select
                value={hhRegion}
                onChange={(e) => setHhRegion(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
              >
                {ALIBABA_REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
              <div className="text-[9px] text-zinc-600 leading-snug">
                Per the docs, model + endpoint + key must all belong to the same region. Cross-region calls fail.
              </div>
            </div>

            <p className="text-[10px] text-zinc-600">
              Get your key at{" "}
              <a href="https://modelstudio.console.alibabacloud.com/" onClick={openExternal} className="text-brand-400 hover:underline cursor-pointer">
                modelstudio.console.alibabacloud.com
              </a>
              {" "}→ API key.
            </p>
          </div>
        </div>
      </div>

      {/* Model selector */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-200">Model</h2>
        <div className="space-y-1.5">
          {MODEL_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setModel(opt.id)}
              className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition ${
                model === opt.id
                  ? "border-brand-500 bg-brand-500/10"
                  : "border-zinc-700 bg-zinc-800/30 hover:border-zinc-600"
              }`}
            >
              <div className={`w-3.5 h-3.5 rounded-full border-2 mt-0.5 flex-shrink-0 transition ${
                model === opt.id ? "border-brand-400 bg-brand-400" : "border-zinc-500"
              }`} />
              <div className="min-w-0">
                <div className={`text-xs font-medium ${model === opt.id ? "text-brand-300" : "text-zinc-300"}`}>
                  {opt.label}
                </div>
                <div className="text-[10px] text-zinc-500 font-mono">{opt.id_str}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-zinc-400">{opt.desc}</span>
                  <span className="text-[10px] text-amber-400 font-mono">{opt.price}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-zinc-600">
          Changes apply to the next generation. Cost estimate updates automatically.
        </p>
      </div>

      {/* Video hosting */}
      <div className="space-y-1.5">
        <h2 className="text-sm font-semibold text-zinc-200 mb-1">Reference Video Hosting</h2>
        <label className="flex items-start gap-3 p-3 rounded-xl border border-zinc-700 bg-zinc-800/30 cursor-pointer hover:border-zinc-600">
          <input
            type="checkbox"
            checked={autoHost}
            onChange={(e) => setAutoHost(e.target.checked)}
            className="mt-0.5 accent-brand-500"
          />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-zinc-200 font-medium">Auto-upload local videos to tmpfiles.org</div>
            <div className="text-[10px] text-zinc-500 mt-0.5 leading-snug">
              Convenience: local video files (and AE work-area exports) are auto-uploaded and turned into a
              public HTTPS URL (~60 min retention, then auto-deleted). Required because BytePlus only accepts
              public URLs for video references.
              <br />
              <span className="text-amber-400/90">When OFF:</span> files are saved to your output folder and
              you paste a URL manually after hosting them yourself (privacy-respecting).
            </div>
          </div>
        </label>
      </div>

      {/* BytePlus Asset helper shortcut */}
      <div className="space-y-1.5">
        <h2 className="text-sm font-semibold text-zinc-200 mb-1">BytePlus Asset Library</h2>
        <div className="bg-zinc-800/30 border border-zinc-700 rounded-xl p-3 space-y-2">
          <div className="text-[11px] text-zinc-400 leading-snug">
            For real-person faces or licensed characters, BytePlus requires a registered
            <span className="font-mono text-zinc-200"> asset://&lt;ID&gt;</span> reference. Use this helper
            to walk through registration and paste your Asset ID.
          </div>
          <button
            onClick={onOpenAssetHelper}
            disabled={!onOpenAssetHelper}
            className="w-full px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs disabled:opacity-50"
          >
            Open BytePlus Asset helper →
          </button>
        </div>
      </div>

      {/* Output folder */}
      <div className="space-y-1.5">
        <h2 className="text-sm font-semibold text-zinc-200 mb-1">Output Folder</h2>
        <label className="text-xs font-medium text-zinc-400">
          Fallback folder when the AE project is unsaved
        </label>
        <input
          type="text"
          value={outputDir}
          onChange={(e) => setOutputDir(e.target.value)}
          placeholder={getDefaultOutputDir() || "e.g. C:\\Users\\you\\Seedance"}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500 font-mono"
        />
        <div className="text-[10px] text-zinc-500 bg-zinc-800/40 rounded-lg px-3 py-2 leading-snug space-y-1">
          <div>
            <span className="text-zinc-300 font-medium">When AE project is saved:</span> outputs go to{" "}
            <span className="font-mono text-zinc-300">&lt;project_folder&gt;/Seedance/&lt;type&gt;/</span>
          </div>
          <div>
            <span className="text-zinc-300 font-medium">When AE project is unsaved (or no AE):</span>{" "}
            <span className="font-mono text-zinc-300">&lt;this folder&gt;/&lt;type&gt;/</span>
          </div>
          <div>
            <span className="text-zinc-300 font-medium">Subfolders:</span>{" "}
            <span className="font-mono">video/</span>, <span className="font-mono">image/</span>,{" "}
            <span className="font-mono">snapshot/</span>
          </div>
          <div className="text-zinc-600">
            Default if blank: <span className="text-zinc-400">{getDefaultOutputDir() || "~/Seedance"}</span>
          </div>
        </div>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        className={`w-full py-2.5 rounded-xl font-semibold text-sm transition ${
          saved
            ? "bg-emerald-500 text-white"
            : "bg-brand-600 text-white hover:bg-brand-700"
        }`}
      >
        {saved ? "✓ Saved" : "Save Settings"}
      </button>

      {/* About */}
      <div className="border-t border-zinc-800 pt-4 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-200">About</h2>
        <div className="bg-zinc-800/50 rounded-xl p-4 space-y-2 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="text-zinc-200 font-medium">Seedance Studio</div>
              <div className="text-zinc-500">BytePlus Seedance 2.0 for After Effects</div>
            </div>
          </div>
          <div className="space-y-1 pt-1">
            <div className="flex justify-between">
              <span className="text-zinc-500">Version</span>
              <span className="text-zinc-300">2.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Model</span>
              <span className="text-zinc-300 font-mono text-[10px]">dreamina-seedance-2-0-260128</span>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center space-y-2">
          <img
            src="homo-lapis-logo.png"
            alt="Homo Lapis"
            className="h-10 mx-auto mb-1 opacity-90"
            onError={(e) => { e.target.style.display = "none"; }}
          />
          <div className="text-xs text-zinc-400 font-medium">Powered by Homo Lapis</div>
          <div className="text-[10px] text-zinc-500">
            <a href="https://homolapis.ai" onClick={openExternal} className="text-brand-400 hover:underline cursor-pointer">homolapis.ai</a>
            {" · "}
            <a href="mailto:info@homolapis.ai" onClick={openExternal} className="text-brand-400 hover:underline cursor-pointer">info@homolapis.ai</a>
          </div>
        </div>
      </div>
    </div>
  );
}
