# Changelog

## [1.0.0] - 2026-05-17

### First public release.
Seedance Studio for After Effects: an open-source CEP panel that puts
AI video generation one click away from the After Effects timeline.

#### Included
- Two-panel CEP extension (Seedance Studio + Storyboarder).
- Text/image/video to video via BytePlus ARK (Seedance 2.0 standard
  and fast).
- HappyHorse 1.0 (Alibaba Cloud / DashScope) with four modes.
- Depth and pose preprocessors via fal.ai.
- Z.AI prompt assistant.
- Cost estimator and lifetime spend tracker.
- Storyboard scan, generate, replace-placeholders flow.
- 15-second-cap-aware work-area render.
- React UI source under `frontend-src/`.
- Cross-platform install scripts (`install.bat` for Windows,
  `install.sh` for macOS).
- Architecture, models, usage, and security docs.

#### License
- GPL-3.0. See [LICENSE](LICENSE).

#### Known limitations
- Storyboarder UI ships as a pre-built `storyboarder.js`; a clean
  source tree for it isn't in this repo yet.
- The plugin is unsigned: install scripts enable CEP debug mode for
  you.
- No Linux support (Adobe doesn't run there).
