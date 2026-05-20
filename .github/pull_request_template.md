## What this PR does

One sentence.

## Why

Link to the issue, or one sentence of context.

## Screenshots / GIF

For UI changes, attach a screenshot or 5-second screencap. For host
script changes, paste the before/after AE behavior.

## Checklist

- [ ] One feature per PR. No drive-by refactors.
- [ ] If `host/index.jsx` is touched, all mutations are wrapped in
      `app.beginUndoGroup()` / `app.endUndoGroup()`.
- [ ] No new runtime dependencies (or justified in the PR body).
- [ ] No telemetry. No analytics. No "anonymous usage stats".
- [ ] README / docs updated if user-facing behavior changed.
- [ ] My contribution is licensed under GPL-3.0, same as the rest
      of the codebase. (See [CONTRIBUTING.md](../CONTRIBUTING.md).)
