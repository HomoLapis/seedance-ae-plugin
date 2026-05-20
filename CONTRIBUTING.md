# Contributing

Hi, and thanks for caring.

This is a small project from a small team (me). We try to merge fast
and release boring. To keep that going, here are the rules of the road.

## TL;DR

1. **Open an issue first** for anything bigger than a typo. Cheap, fast,
   saves you writing 800 lines of code we ask you to revert.
2. **One feature per PR.** Drive-by refactors get bounced. Open a second
   PR for them.
3. **Screenshots or it didn't happen.** UI changes → attach a screenshot
   or 5-second GIF.
4. **Undo groups.** Anything touching `host/index.jsx` MUST wrap
   destructive AE ops in `app.beginUndoGroup("...")`/`app.endUndoGroup()`.
5. **No telemetry. Ever.** Don't add it. Don't propose adding it.

## Setting up locally

```bash
git clone <your-fork>
cd seedance-ae-plugin/frontend-src
npm install
npm run dev       # iterate the UI in a normal browser
# when ready to test in AE:
npm run build:cep
cd ..
./install.sh      # or install.bat on Windows
# then restart After Effects
```

The UI degrades gracefully when `window.CSInterface` is absent, so you can
do 90% of the work in a regular browser and only fire up AE to verify
import / placement / render code paths.

## Code style

- JS: 2-space indent, no semicolons-on-the-front, double quotes for JSX,
  follow the surrounding file.
- ExtendScript: stick to ES3-ish syntax (no `let`, no `const`, no arrow
  fns, no template literals). It runs in an ancient JS engine. Yes,
  really.
- Tailwind: use what's already there. No CSS-in-JS. No custom design
  systems.

## What we'll happily merge

- Bug fixes with a clear reproduction.
- New model adapters (Wan, Kling, Hunyuan, Veo, …) following the existing
  shape in `frontend-src/src/api.js`.
- Better / clearer error messages.
- Performance work on `host/index.jsx`, especially `scanWorkAreaImages`
  and `placeStoryboardClips` on long timelines.
- macOS-specific install fixes. Primary dev is on Windows.

## What we'll probably push back on

- Build-system rewrites (Webpack, Turbopack, Bun, esbuild plugins…).
  Vite is fine.
- New runtime dependencies. Every `npm i` is a maintenance debt.
- Premiere / Photoshop / Resolve ports inside this repo. Fork and link.
- "Cleanup" PRs that touch 70 files. Pass.

## Security

If you spot something that leaks an API key, exposes user data, or lets
an external page exfiltrate a token from the panel: **don't open a
public issue**. Email `info@homolapis.ai` with the details and we'll
prioritize a fix. We'll credit you (or keep you anonymous, your call).

## License of your contribution

This project is licensed under **GPL-3.0** (see [LICENSE](LICENSE)).

By opening a pull request, you confirm that:

1. You are the author of your contribution, **or** you have the
   right to submit it under these terms.
2. You **license your contribution under GPL-3.0**, on the same
   terms as the rest of the codebase (inbound = outbound).
3. You **retain copyright** on your contribution. You are not
   transferring ownership: you are granting a license.

## Commercial use

The plugin is GPL-3.0. You can fork it, modify it, and even sell
it, as long as your fork is itself GPL-3.0 compatible (you publish
your modifications under GPL-3.0 too).

For *custom builds*, *training*, or *priority support*, that's what
we sell: `info@homolapis.ai`. We'd rather you ask than
reverse-engineer the same thing twice.
