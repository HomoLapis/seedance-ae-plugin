export default function History({ items, onRestore, onOpenPreview }) {
  if (!items || items.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-600 text-sm">
        No generations yet
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
      {items.map((item, i) => (
        <div
          key={item.taskId || i}
          className="bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-600 rounded-lg p-2.5 space-y-1.5 transition"
        >
          {/* Top row: status + cost + timestamp */}
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
              item.status === "succeeded" ? "bg-emerald-500/10 text-emerald-400" :
              item.status === "failed"    ? "bg-red-500/10 text-red-400" :
              "bg-zinc-700 text-zinc-400"
            }`}>
              {item.status === "succeeded" ? "✓ Done" : item.status === "failed" ? "✕ Failed" : "⋯ Running"}
            </span>
            <div className="flex items-center gap-2 text-[10px] text-zinc-500">
              {item.createdAt && (
                <span>{formatTimestamp(item.createdAt)}</span>
              )}
              <span className="font-mono">${item.estimatedCost?.toFixed(4) || "—"}</span>
            </div>
          </div>

          {/* Prompt */}
          <p className="text-xs text-zinc-300 line-clamp-2 leading-snug">{item.prompt}</p>

          {/* Params row */}
          <div className="flex gap-1.5 flex-wrap text-[10px] text-zinc-500">
            {item.mode && <span className="bg-zinc-800 rounded px-1.5 py-0.5">{item.mode}</span>}
            {item.resolution && <span className="bg-zinc-800 rounded px-1.5 py-0.5">{item.resolution}</span>}
            {item.ratio && item.ratio !== "adaptive" && <span className="bg-zinc-800 rounded px-1.5 py-0.5">{item.ratio}</span>}
            {item.duration != null && <span className="bg-zinc-800 rounded px-1.5 py-0.5">{item.duration === -1 ? "auto" : `${item.duration}s`}</span>}
            {item.audio && <span className="bg-zinc-800 rounded px-1.5 py-0.5">🔊</span>}
            {item.cameraFixed && <span className="bg-zinc-800 rounded px-1.5 py-0.5">📷 fixed</span>}
          </div>

          {/* Actions row */}
          <div className="flex gap-1.5 flex-wrap pt-0.5">
            {onRestore && (
              <button
                onClick={() => onRestore(item)}
                className="text-[10px] px-2 py-1 rounded bg-brand-600/20 hover:bg-brand-600/30 border border-brand-500/30 text-brand-300"
                title="Load these settings into the form to edit and regenerate"
              >↻ Reuse settings</button>
            )}
            {item.videoUrl && onOpenPreview && (
              <button
                onClick={() => onOpenPreview({ src: item.videoUrl, title: item.prompt?.slice(0, 60) || "Video" })}
                className="text-[10px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200"
              >▶ Preview</button>
            )}
            {item.videoUrl && (
              <a
                href={item.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200"
              >🔗 URL</a>
            )}
            {item.taskId && (
              <span className="text-[10px] font-mono text-zinc-600 self-center truncate max-w-[120px]" title={item.taskId}>
                {item.taskId.slice(0, 8)}…
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatTimestamp(ts) {
  try {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString();
  } catch {
    return "";
  }
}
