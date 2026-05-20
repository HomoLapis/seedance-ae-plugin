import { useState } from "react";
import {
  promptAssist,        promptAssistRefined,
  promptAssist15,      promptAssistRefined15,
  promptAssistHH,      promptAssistRefinedHH,
} from "../api.js";

/**
 * Prompt Assistant — two generation modes:
 *
 *   ⚡ Fast     — single GLM call (lowest latency, 3-6 s typical)
 *   🎯 Refined — Karpathy-style actor-critic loop: generate → evaluate
 *                against deterministic constraints derived from the
 *                official Seedance docs → rewrite only what failed.
 *                Up to 2 rewrite passes. 2-3× the latency, dramatically
 *                higher consistency on citation / motion / meta-prefix rules.
 *
 * In both modes the result is shown in an EDITABLE textarea — the user can
 * tweak anything before clicking "Use this prompt".
 *
 * Props:
 *   - mode      : "ref" / "i2v" / "i2v_fl" / "t2v"  (Seedance 2.0 modes)
 *                 OR "t2v" / "i2v" / "flf"          (Seedance 1.5 Pro modes)
 *   - variant   : "20" (default) | "15"  — chooses which guide / API pair to use
 *   - onUsePrompt(prompt)  — called when user clicks "Use this prompt"
 *   - images    : { firstFrameUploadId, firstFrameUrl, lastFrameUploadId,
 *                   lastFrameUrl, refImages, refVideos, refAudios }
 */
export default function PromptAssistant({ mode, onUsePrompt, images, variant = "20" }) {
  const isV15 = variant === "15";
  const isHH  = variant === "hh";
  const fastFn    = isHH ? promptAssistHH        : isV15 ? promptAssist15        : promptAssist;
  const refinedFn = isHH ? promptAssistRefinedHH : isV15 ? promptAssistRefined15 : promptAssistRefined;
  const guideLabel = isHH ? "HappyHorse 1.0" : isV15 ? "Seedance 1.5 Pro" : "Seedance 2.0";
  const [userRequest, setUserRequest] = useState("");
  const [result, setResult]           = useState("");
  const [loading, setLoading]         = useState(false);
  const [loadingKind, setLoadingKind] = useState(null); // "fast" | "refined" | null
  const [error, setError]             = useState(null);
  const [diagnostics, setDiagnostics] = useState(null); // { passed, iterations, history }
  const [showDetails, setShowDetails] = useState(false);
  const [progressStage, setProgressStage] = useState(null);

  // Vision mode kicks in whenever ANY image-bearing reference is attached
  // (first frame, last frame, OR any reference_image slot — including images
  // just edited with the pencil icon, which end up in refImages).
  const hasImages = !!(
    images?.firstFrameUploadId || images?.firstFrameUrl ||
    images?.lastFrameUploadId  || images?.lastFrameUrl  ||
    (Array.isArray(images?.refImages) && images.refImages.some(Boolean))
  );
  const hasRefVideos = Array.isArray(images?.refVideos) && images.refVideos.some(Boolean);
  const hasRefAudios = Array.isArray(images?.refAudios) && images.refAudios.some(Boolean);
  const refBadgeCount = [
    Array.isArray(images?.refImages) ? images.refImages.filter(Boolean).length : 0,
    hasRefVideos ? images.refVideos.filter(Boolean).length : 0,
    hasRefAudios ? images.refAudios.filter(Boolean).length : 0,
  ].reduce((a, b) => a + b, 0);

  const resetOutputs = () => {
    setResult("");
    setError(null);
    setDiagnostics(null);
    setShowDetails(false);
    setProgressStage(null);
  };

  const handleFast = async () => {
    if (!userRequest.trim() || loading) return;
    setLoading(true);
    setLoadingKind("fast");
    resetOutputs();
    try {
      const data = await fastFn(userRequest.trim(), mode, images || {});
      setResult(data.prompt);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setLoadingKind(null);
    }
  };

  const handleRefined = async () => {
    if (!userRequest.trim() || loading) return;
    setLoading(true);
    setLoadingKind("refined");
    resetOutputs();
    try {
      const data = await refinedFn(userRequest.trim(), mode, images || {}, {
        maxIter: 2,
        onProgress: ({ stage, iteration, failures }) => {
          if (stage === "generate") setProgressStage("Drafting initial prompt…");
          else if (stage === "rewrite") {
            const n = failures?.length || 0;
            setProgressStage(`Refining (pass ${iteration}/2) — fixing ${n} issue${n === 1 ? "" : "s"}…`);
          } else if (stage === "done") setProgressStage(null);
        },
      });
      setResult(data.prompt);
      setDiagnostics({
        passed:     data.passed,
        iterations: data.iterations,
        history:    data.history,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setLoadingKind(null);
      setProgressStage(null);
    }
  };

  const handleKeyDown = (e) => {
    // Enter (no modifier) → Fast; Shift+Enter → newline; Ctrl/Cmd+Enter → Refined
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) handleRefined();
      else                        handleFast();
    }
  };

  const handleUse = () => {
    if (result) onUsePrompt(result);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Prompt Assistant
        </h3>
        <span className="text-[9px] text-zinc-600 ml-1" title={`Guide: ${guideLabel}`}>
          {isHH ? "HappyHorse" : isV15 ? "1.5 Pro" : "2.0"}
        </span>
        {hasImages && (
          <span className="text-[10px] text-emerald-400 ml-1"
            title="The assistant can see your reference images (including edited ones).">
            👁 vision
          </span>
        )}
        {refBadgeCount > 0 && (
          <span className="text-[10px] text-brand-300 ml-1"
            title="Attached references the assistant will cite">
            {refBadgeCount} ref{refBadgeCount > 1 ? "s" : ""}
          </span>
        )}
        <span className="text-[10px] text-zinc-600 ml-auto">
          {hasImages ? "GLM-4.6V" : "GLM-5"}
        </span>
      </div>

      {/* User input */}
      <div className="relative">
        <textarea
          value={userRequest}
          onChange={(e) => setUserRequest(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="Describe your video idea in any language… (Enter = Fast, Ctrl+Enter = Refined)"
          className="prompt-textarea w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 resize-none"
        />
      </div>

      {/* Two generation modes */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={handleFast}
          disabled={loading || !userRequest.trim()}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition border ${
            loading && loadingKind === "fast"
              ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
              : "border-zinc-700 bg-zinc-800 text-zinc-200 hover:border-amber-500/50 hover:bg-zinc-800/60 disabled:opacity-40 disabled:cursor-not-allowed"
          }`}
          title="Single GLM pass — fastest, usually 3–6 seconds"
        >
          {loading && loadingKind === "fast" ? (
            <span className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full spin-slow" />
          ) : (
            <span>⚡</span>
          )}
          Fast
        </button>
        <button
          onClick={handleRefined}
          disabled={loading || !userRequest.trim()}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition border ${
            loading && loadingKind === "refined"
              ? "border-brand-500/60 bg-brand-500/10 text-brand-300"
              : "border-brand-500/40 bg-brand-500/10 text-brand-300 hover:bg-brand-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          }`}
          title="Actor-critic loop: generate → check against docs rules → rewrite only failures (up to 2 passes). ~2-3× slower but higher consistency."
        >
          {loading && loadingKind === "refined" ? (
            <span className="w-3.5 h-3.5 border-2 border-brand-400 border-t-transparent rounded-full spin-slow" />
          ) : (
            <span>🎯</span>
          )}
          Refined
        </button>
      </div>

      {/* Progress line while refining */}
      {progressStage && (
        <div className="text-[10px] text-brand-300 bg-brand-500/5 rounded px-2 py-1 flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 border-[1.5px] border-brand-400 border-t-transparent rounded-full spin-slow flex-shrink-0" />
          {progressStage}
        </div>
      )}

      {error && <div className="text-xs text-red-400 bg-red-400/10 rounded p-2">{error}</div>}

      {/* Result — editable */}
      {result && (
        <div className="space-y-2">
          {/* Refinement status banner */}
          {diagnostics && (
            <div className={`flex items-center justify-between gap-2 text-[10px] rounded px-2 py-1 ${
              diagnostics.passed
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-amber-500/10 text-amber-300"
            }`}>
              <span>
                {diagnostics.passed
                  ? (diagnostics.iterations === 0
                      ? "✓ All constraints passed on the first draft."
                      : `✓ Refined ${diagnostics.iterations} time${diagnostics.iterations === 1 ? "" : "s"} — all constraints now pass.`)
                  : `⚠ Refined ${diagnostics.iterations} time${diagnostics.iterations === 1 ? "" : "s"} — some constraints still fail. Edit below before using.`}
              </span>
              <button
                onClick={() => setShowDetails((v) => !v)}
                className="underline decoration-dotted hover:text-white"
              >
                {showDetails ? "hide details" : "details"}
              </button>
            </div>
          )}

          {/* Diagnostics details */}
          {diagnostics && showDetails && (
            <div className="bg-zinc-800/40 border border-zinc-700 rounded-lg p-2 space-y-1.5 text-[10px]">
              {diagnostics.history.map((h, i) => (
                <div key={i} className="space-y-0.5">
                  <div className="font-medium text-zinc-300">
                    {i === 0 ? "Initial draft" : `Rewrite pass ${h.iteration}`}
                    <span className={`ml-2 ${h.failures.length === 0 ? "text-emerald-400" : "text-amber-400"}`}>
                      {h.failures.length === 0 ? "✓ 0 failures" : `⚠ ${h.failures.length} failure${h.failures.length === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  {h.failures.length > 0 && (
                    <ul className="ml-3 text-zinc-500 space-y-0.5 list-disc">
                      {h.failures.map((f, j) => (
                        <li key={j}>
                          <span className="text-zinc-400 font-mono">{f.id}</span>
                          {" — "}
                          {f.msg}
                        </li>
                      ))}
                    </ul>
                  )}
                  {h.error && (
                    <div className="ml-3 text-red-400">Error: {h.error}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Editable result textarea */}
          <textarea
            value={result}
            onChange={(e) => setResult(e.target.value)}
            rows={Math.min(12, Math.max(4, result.split("\n").length + 1))}
            className="prompt-textarea w-full bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 leading-relaxed focus:outline-none focus:border-amber-500/50 resize-y"
            spellCheck={false}
          />
          <div className="flex items-center justify-between text-[10px] text-zinc-600">
            <span>Tip: edit above before using — your changes are preserved.</span>
            <span>{result.split(/\s+/).filter(Boolean).length} words</span>
          </div>

          <button
            onClick={handleUse}
            disabled={!result.trim()}
            className="w-full py-2 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-medium hover:bg-amber-500/30 transition flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Use this prompt
          </button>
        </div>
      )}
    </div>
  );
}
