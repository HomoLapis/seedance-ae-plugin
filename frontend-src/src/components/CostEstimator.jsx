export default function CostEstimator({ estimate, loading }) {
  if (loading) {
    return (
      <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4 animate-pulse">
        <div className="h-4 bg-zinc-700 rounded w-24 mb-2" />
        <div className="h-8 bg-zinc-700 rounded w-20" />
      </div>
    );
  }

  if (!estimate) return null;

  return (
    <div className="bg-gradient-to-br from-zinc-800/80 to-zinc-900/80 border border-zinc-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Estimated Cost</span>
        <span className="text-xs text-zinc-500 font-mono">{estimate.tokens?.toLocaleString()} tokens</span>
      </div>

      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold text-white font-mono">
          ${estimate.cost_usd?.toFixed(4)}
        </span>
        <span className="text-sm text-zinc-500">USD</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
        <div>
          <span className="text-zinc-500">Resolution:</span>{" "}
          <span className="text-zinc-300">{estimate.resolution_px}</span>
        </div>
        <div>
          <span className="text-zinc-500">Duration:</span>{" "}
          <span className="text-zinc-300">{estimate.duration}s</span>
        </div>
        <div>
          <span className="text-zinc-500">Rate:</span>{" "}
          <span className="text-zinc-300">${estimate.price_per_m_tokens}/M tok</span>
        </div>
        <div>
          <span className="text-zinc-500">Audio:</span>{" "}
          <span className="text-zinc-300">{estimate.audio ? "Yes" : "No"}</span>
        </div>
        {estimate.draft && (
          <div className="col-span-2">
            <span className="inline-block px-2 py-0.5 bg-amber-900/40 text-amber-400 rounded text-xs">Draft mode (480p)</span>
          </div>
        )}
      </div>
    </div>
  );
}
