export default function SpendingTracker({ totalSpent, taskCount }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-emerald-500" />
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Session Spending</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-emerald-400 font-mono">
          ${totalSpent.toFixed(4)}
        </span>
        <span className="text-xs text-zinc-500">USD</span>
      </div>
      <div className="mt-2 text-xs text-zinc-500">
        {taskCount} generation{taskCount !== 1 ? "s" : ""} this session
      </div>
    </div>
  );
}
