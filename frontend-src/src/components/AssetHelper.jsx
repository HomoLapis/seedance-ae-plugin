import { useState, useEffect, useCallback, useRef } from "react";
import { listTasks } from "../api.js";
import {
  listAssets,
  saveAsset,
  deleteAsset,
  searchAssets,
  normalizeAssetId,
  ASSET_KINDS,
} from "../utils/assetLibrary.js";

const LS_BETA_DISMISSED = "seedance_asset_beta_dismissed";

function openExternalLink(url) {
  try {
    if (typeof window !== "undefined" && window.cep?.util?.openURLInDefaultBrowser) {
      window.cep.util.openURLInDefaultBrowser(url);
      return;
    }
  } catch (_) {}
  window.open(url, "_blank", "noopener,noreferrer");
}

function fmtTime(ts) {
  try {
    const d = new Date(ts * 1000);
    const now = new Date();
    const diffMin = Math.floor((now - d) / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  } catch { return ""; }
}

/**
 * Asset chooser modal — three tabs that mirror the BytePlus playground idea
 * within the limits of the public API:
 *
 *   • My Library     — local asset:// bookmarks (localStorage)
 *   • Recent videos  — the user's Seedance generations via the official
 *                      /contents/generations/tasks list API
 *   • Paste / Save   — paste an ID from the BytePlus console, optionally
 *                      save it to the local library
 *
 * Calls `onUseAsset(uri)` with either a ready-to-use `asset://<id>` URI or a
 * public HTTPS URL (for recent generations). The caller decides what to do
 * with it (inject into a reference slot, etc.).
 */
export default function AssetHelper({ onUseAsset, onClose, suggestedKind }) {
  const [tab, setTab]              = useState("library");  // library | recent | paste
  const [betaDismissed, setBetaDismissed] = useState(false);

  useEffect(() => {
    setBetaDismissed(localStorage.getItem(LS_BETA_DISMISSED) === "1");
  }, []);

  const dismissBeta = () => {
    localStorage.setItem(LS_BETA_DISMISSED, "1");
    setBetaDismissed(true);
  };

  const confirmAsset = (uri) => {
    onUseAsset?.(uri);
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-white">Choose a BytePlus asset</h2>
            <p className="text-[10px] text-zinc-500 leading-tight">
              Browse saved IDs, your recent generations, or paste an ID from the BytePlus console.
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-lg leading-none">×</button>
        </div>

        {/* Tab nav */}
        <div className="flex border-b border-zinc-800 flex-shrink-0 px-2">
          {[
            { id: "library", label: "📁 My Library",      hint: "Saved locally in this plugin" },
            { id: "recent",  label: "🎬 Recent videos",   hint: "Your Seedance generations (last 7 days)" },
            { id: "paste",   label: "➕ Paste / Save new", hint: "Paste an ID from the BytePlus console" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={t.hint}
              className={`px-3 py-2 text-xs font-medium transition border-b-2 -mb-px ${
                tab === t.id
                  ? "border-brand-500 text-brand-300"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "library" && (
            <LibraryTab onUse={confirmAsset} suggestedKind={suggestedKind} />
          )}
          {tab === "recent" && (
            <RecentTab onUse={confirmAsset} />
          )}
          {tab === "paste" && (
            <PasteTab
              onUse={confirmAsset}
              betaDismissed={betaDismissed}
              onDismissBeta={dismissBeta}
              suggestedKind={suggestedKind}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab 1 — My Library ──────────────────────────────────────────────────────

function LibraryTab({ onUse, suggestedKind }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState(() => listAssets());
  const [filterKind, setFilterKind] = useState(suggestedKind || "all");

  const refresh = useCallback(() => setItems(searchAssets(query)), [query]);
  useEffect(() => { refresh(); }, [refresh]);

  const filtered = filterKind === "all"
    ? items
    : items.filter((a) => a.kind === filterKind);

  const handleDelete = (id) => {
    if (!confirm(`Remove this asset from your library?`)) return;
    deleteAsset(id);
    setItems(searchAssets(query));
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by nickname, ID, or notes…"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500"
        />
        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
        >
          <option value="all">All kinds</option>
          {ASSET_KINDS.map((k) => (
            <option key={k.id} value={k.id}>{k.label}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8 text-zinc-500 text-xs">
          {items.length === 0
            ? <>Your library is empty. Open the <span className="text-zinc-300 font-medium">Paste / Save new</span> tab to add your first asset.</>
            : "No assets match the current filters."}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {filtered.map((a) => (
            <div key={a.id} className="bg-zinc-800/60 border border-zinc-700 rounded-lg overflow-hidden group hover:border-brand-500 transition">
              <div className="h-24 bg-zinc-900 flex items-center justify-center overflow-hidden">
                {a.thumbnail
                  ? <img src={a.thumbnail} alt="" className="w-full h-full object-cover" />
                  : <KindIcon kind={a.kind} />}
              </div>
              <div className="p-2 space-y-1">
                <div className="text-xs font-medium text-zinc-100 truncate" title={a.nickname}>
                  {a.nickname}
                </div>
                <div className="flex items-center gap-1.5 text-[9px]">
                  <span className="bg-zinc-700 text-zinc-300 rounded px-1.5 py-0.5">
                    {ASSET_KINDS.find((k) => k.id === a.kind)?.label || a.kind}
                  </span>
                  <span className="text-zinc-600 font-mono truncate flex-1" title={a.id}>
                    {a.id.length > 8 ? `…${a.id.slice(-8)}` : a.id}
                  </span>
                </div>
                <div className="flex gap-1 pt-0.5">
                  <button
                    onClick={() => onUse(`asset://${a.id}`)}
                    className="flex-1 px-2 py-1 rounded bg-brand-600 hover:bg-brand-700 text-white text-[10px] font-medium"
                  >Use</button>
                  <button
                    onClick={() => handleDelete(a.id)}
                    className="px-2 py-1 rounded bg-zinc-700 hover:bg-red-600/80 text-zinc-300 hover:text-white text-[10px]"
                    title="Remove from library"
                  >🗑</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab 2 — Recent generations (from /tasks API) ────────────────────────────

function RecentTab({ onUse }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const fetchedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items } = await listTasks({ status: "succeeded", pageNum: 1, pageSize: 50 });
      setItems(items);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-zinc-400 leading-snug">
          Your last 7 days of Seedance tasks. <span className="text-amber-300">Video URLs expire 24h after the task succeeds</span> —
          but face-containing Seedance 2.0 outputs stay usable as input assets for 30 days.
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-[10px] px-2 py-1 rounded bg-zinc-800 border border-zinc-700 hover:border-zinc-500 text-zinc-300 disabled:opacity-50"
        >
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div className="text-[11px] text-red-400 bg-red-400/10 border border-red-500/30 rounded p-2">
          {error}
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="text-center py-8 text-zinc-500 text-xs">Loading your recent generations…</div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="text-center py-8 text-zinc-500 text-xs">
          No generations found in the last 7 days.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {items.map((task) => {
          const url = task.content?.video_url;
          const expired = !url;
          return (
            <div key={task.id} className={`bg-zinc-800/60 border rounded-lg overflow-hidden group transition ${
              expired ? "border-zinc-800 opacity-60" : "border-zinc-700 hover:border-brand-500"
            }`}>
              <div className="h-24 bg-black flex items-center justify-center overflow-hidden">
                {url ? (
                  <video src={url} muted playsInline preload="none" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[10px] text-zinc-600">URL expired</span>
                )}
              </div>
              <div className="p-2 space-y-0.5">
                <div className="flex items-center gap-1.5 text-[9px]">
                  <span className="bg-zinc-700 text-zinc-300 rounded px-1.5 py-0.5">
                    {task.resolution || "—"}
                  </span>
                  <span className="bg-zinc-700 text-zinc-300 rounded px-1.5 py-0.5">
                    {task.ratio || "—"}
                  </span>
                  <span className="text-zinc-600 ml-auto">{fmtTime(task.created_at)}</span>
                </div>
                <div className="text-[9px] text-zinc-600 font-mono truncate" title={task.id}>
                  {task.id}
                </div>
                <div className="flex gap-1 pt-0.5">
                  <button
                    onClick={() => onUse(url)}
                    disabled={expired}
                    className="flex-1 px-2 py-1 rounded bg-brand-600 hover:bg-brand-700 text-white text-[10px] font-medium disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed"
                    title={expired ? "Video URL has expired (24h limit)" : "Use this URL as a reference video"}
                  >Use URL</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab 3 — Paste + Save ────────────────────────────────────────────────────

function PasteTab({ onUse, betaDismissed, onDismissBeta, suggestedKind }) {
  const [assetId,   setAssetId]   = useState("");
  const [nickname,  setNickname]  = useState("");
  const [kind,      setKind]      = useState(suggestedKind || "character");
  const [thumbnail, setThumbnail] = useState("");
  const [notes,     setNotes]     = useState("");
  const [saveLocal, setSaveLocal] = useState(true);
  const [error,     setError]     = useState(null);

  const use = () => {
    setError(null);
    const nid = normalizeAssetId(assetId);
    if (!nid) {
      setError("Paste an Asset ID first.");
      return;
    }
    if (saveLocal) {
      if (!nickname.trim()) {
        setError("Add a nickname to save this asset to your library (or untick the save option).");
        return;
      }
      try {
        saveAsset({ id: nid, nickname, kind, thumbnail: thumbnail.trim() || null, notes });
      } catch (e) {
        setError(e.message);
        return;
      }
    }
    onUse(`asset://${nid}`);
  };

  return (
    <div className="space-y-4">
      {!betaDismissed && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-[11px] text-amber-200 leading-relaxed">
          <div className="font-semibold mb-1">⚠ Digital Character Library is in beta</div>
          <div className="text-amber-100/90">
            BytePlus does not currently expose a public API to list the library — so we can't embed a real browser
            of Templates / Elements / Digital characters inside the plugin. You browse those in the BytePlus console,
            copy an Asset ID, paste it here, and optionally save it to <span className="font-medium">My Library</span> below
            for one-click reuse.
          </div>
          <button
            onClick={onDismissBeta}
            className="mt-1.5 text-[10px] text-amber-300 hover:text-amber-200 underline"
          >Hide this notice</button>
        </div>
      )}

      {/* Shortcut links to the console */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Browse on BytePlus</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <button
            onClick={() => openExternalLink("https://console.byteplus.com/ark")}
            className="px-3 py-2 bg-zinc-800 border border-zinc-700 hover:border-brand-500 rounded-lg text-[11px] text-zinc-300 hover:text-white transition text-left"
          >
            <div className="font-medium">Open ModelArk Playground →</div>
            <div className="text-[9px] text-zinc-500">Browse Templates / Elements / Digital characters</div>
          </button>
          <button
            onClick={() => openExternalLink("https://docs.byteplus.com/en/docs/ModelArk/2223965")}
            className="px-3 py-2 bg-zinc-800 border border-zinc-700 hover:border-brand-500 rounded-lg text-[11px] text-zinc-300 hover:text-white transition text-left"
          >
            <div className="font-medium">Read official library docs →</div>
            <div className="text-[9px] text-zinc-500">ModelArk/2223965 (beta)</div>
          </button>
          <button
            onClick={() => openExternalLink("https://console.byteplus.com/workorder/create?step=2&SubProductID=P00001514")}
            className="px-3 py-2 bg-zinc-800 border border-zinc-700 hover:border-brand-500 rounded-lg text-[11px] text-zinc-300 hover:text-white transition text-left"
          >
            <div className="font-medium">Request beta access (ticket) →</div>
            <div className="text-[9px] text-zinc-500">Pre-filled workorder</div>
          </button>
        </div>
      </div>

      {/* Paste form */}
      <div className="space-y-2 bg-zinc-800/40 border border-zinc-700 rounded-xl p-3">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Asset ID</label>
          <input
            type="text"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            placeholder="e.g. 7321234567890123 or asset://7321234567890123"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-brand-500"
            onKeyDown={(e) => e.key === "Enter" && use()}
          />
          <div className="text-[9px] text-zinc-600">
            Will be sent to BytePlus as <span className="font-mono">asset://{normalizeAssetId(assetId) || "<id>"}</span>
          </div>
        </div>

        <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={saveLocal}
            onChange={(e) => setSaveLocal(e.target.checked)}
            className="accent-brand-500"
          />
          Also save to <span className="text-zinc-200 font-medium">My Library</span> for one-click re-use next time
        </label>

        {saveLocal && (
          <div className="space-y-2 pt-1 pl-5 border-l border-zinc-700/50">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-zinc-400">Nickname</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. Young male professor"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-zinc-400">Kind</label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
                >
                  {ASSET_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>{k.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-zinc-400">
                Thumbnail URL <span className="text-zinc-600 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={thumbnail}
                onChange={(e) => setThumbnail(e.target.value)}
                placeholder="https://... (screenshot from the console, helpful for recognition)"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-zinc-400">
                Notes <span className="text-zinc-600 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Short description, tags, where you found it…"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>
        )}

        {error && (
          <div className="text-[11px] text-red-400 bg-red-400/10 border border-red-500/30 rounded p-2">
            {error}
          </div>
        )}

        <button
          onClick={use}
          disabled={!assetId.trim()}
          className="w-full px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-xs font-medium"
        >
          {saveLocal ? "Save & Use asset://" : "Use asset:// (don't save)"}
        </button>
      </div>
    </div>
  );
}

// ── small helpers ───────────────────────────────────────────────────────────

function KindIcon({ kind }) {
  const icons = {
    character: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
    image:     "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
    video:     "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
    audio:     "M9 19V6l12-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z",
  };
  return (
    <svg className="w-8 h-8 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icons[kind] || icons.image} />
    </svg>
  );
}
