/**
 * Full-screen modal for a video OR image preview.
 * Click outside or × to dismiss.
 *
 * Props: { src, title, isImage?, onClose }
 */
export default function VideoPopup({ src, title, isImage, onClose }) {
  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2 gap-2">
          <div className="text-xs text-zinc-400 truncate flex-1">{title || "Preview"}</div>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-zinc-400 hover:text-white px-2 py-1 rounded bg-zinc-800 border border-zinc-700"
            title="Open in browser"
          >🔗 Open</a>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-white"
          >✕</button>
        </div>
        {isImage ? (
          <img
            src={src}
            alt={title || ""}
            className="w-full max-h-[80vh] object-contain rounded-xl bg-black"
          />
        ) : (
          <video
            src={src}
            controls
            autoPlay
            className="w-full max-h-[80vh] rounded-xl bg-black"
          />
        )}
      </div>
    </div>
  );
}
