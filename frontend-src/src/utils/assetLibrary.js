/**
 * Local asset library — persists BytePlus asset IDs the user has pasted,
 * along with a nickname, kind, and optional thumbnail, so they can be
 * re-used across sessions without re-copying from the BytePlus console.
 *
 * Why local-only?
 *   Per BytePlus docs + our own research, there is NO public API to list
 *   the Digital Character Library, Templates, Elements, or My Assets.
 *   A local library is the only honest way to give the user a "one-click
 *   re-use" flow for asset:// references.
 *
 * Storage key: localStorage["seedance_asset_library"] = JSON array.
 */

const LS_KEY = "seedance_asset_library";

export const ASSET_KINDS = [
  { id: "character", label: "Character",  hint: "Virtual character / digital person" },
  { id: "image",     label: "Image",      hint: "Still-image asset" },
  { id: "video",     label: "Video",      hint: "Video asset" },
  { id: "audio",     label: "Audio",      hint: "Audio asset" },
];

function read() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.warn("Failed to write asset library:", e.message);
    return false;
  }
}

/** Normalize a raw ID string: strip `asset://` prefix, trim, drop angle brackets. */
export function normalizeAssetId(raw) {
  if (!raw) return "";
  return String(raw)
    .trim()
    .replace(/^asset:\/\//i, "")
    .replace(/[<>]/g, "")
    .trim();
}

/** Return the current library as an array of entries, newest first. */
export function listAssets() {
  const items = read();
  return items.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

/** Look up an entry by its normalized ID. */
export function getAsset(id) {
  const nid = normalizeAssetId(id);
  return read().find((a) => a.id === nid) || null;
}

/**
 * Add or update an entry. Returns the stored record.
 *
 * @param {object} entry
 *   - id (required): the asset ID (with or without asset:// prefix)
 *   - nickname (required): human-friendly name
 *   - kind: "character" | "image" | "video" | "audio" (default "character")
 *   - thumbnail: optional URL or data URL
 *   - notes: optional free text
 */
export function saveAsset(entry) {
  const id = normalizeAssetId(entry?.id);
  if (!id) throw new Error("Asset ID is required.");
  if (!entry.nickname || !entry.nickname.trim()) throw new Error("Nickname is required.");

  const list = read();
  const now = Date.now();
  const record = {
    id,
    nickname:  entry.nickname.trim(),
    kind:      entry.kind || "character",
    thumbnail: entry.thumbnail || null,
    notes:     entry.notes || "",
    addedAt:   now,
    updatedAt: now,
  };
  const existing = list.findIndex((a) => a.id === id);
  if (existing >= 0) {
    record.addedAt = list[existing].addedAt || now; // preserve original addedAt
    list[existing] = record;
  } else {
    list.push(record);
  }
  write(list);
  return record;
}

/** Delete by normalized ID. */
export function deleteAsset(id) {
  const nid = normalizeAssetId(id);
  const list = read().filter((a) => a.id !== nid);
  write(list);
}

/** Simple substring/prefix search over nickname, id, notes. */
export function searchAssets(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return listAssets();
  return listAssets().filter(
    (a) =>
      a.nickname.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q) ||
      (a.notes || "").toLowerCase().includes(q)
  );
}
