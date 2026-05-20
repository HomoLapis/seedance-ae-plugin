# Usage guide

Day-to-day usage of Seedance Studio inside After Effects. Assumes the
plugin is already installed (see [README](../README.md#install-5-minutes-0-dependencies))
and you have at least a BytePlus ARK API key.

Two panels under **Window > Extensions**:
- **Seedance Studio**: single-shot generation (text/image/video to video).
- **Storyboarder**: animatic to cut. Multi-shot batch flow.

---

## 1. First-time setup (5 minutes)

1. Open After Effects. **Window > Extensions > Seedance Studio**.
2. Click **Settings** (top right cog icon).
3. Paste your **BytePlus ARK** key. This is the only mandatory key.
4. Optional but useful:
   - **Z.AI** key: enables the Prompt Assistant (GLM-4) buttons.
   - **fal.ai** key: enables Depth Anything + DWPose preprocessors.
   - **Alibaba DashScope** key + region (CN / Intl / US): enables
     HappyHorse 1.0 routes.
5. Pick a default model: `standard` ($7.00/M tok) or `fast`
   ($5.60/M tok). The Fast tier is great while iterating on prompts,
   switch to Standard for the final take.
6. Set the **Output directory** if you don't like the default. All
   generated MP4s are downloaded there before being imported into AE.

Keys are stored in CEP's `localStorage` on your disk. Nothing is sent
anywhere except to the documented vendor endpoints. See
[SECURITY.md](../SECURITY.md) for the audit trail.

---

## 2. Generate a single shot (main panel)

The fastest path: comp open in AE, prompt in the panel, one click,
shot lands on the playhead.

### Step by step

1. Make sure a composition is open in AE and selected. The panel shows
   **AE: No comp** when there's no active comp. Pick one. Move the
   timeline playhead to where you want the new clip to land.
2. Pick the engine tab:
   - **Video 2.0**: Seedance 2.0 on BytePlus ARK. Default.
   - **Video 1.5**: legacy Seedance 1.5 (kept for backward compat).
   - **HappyHorse**: Alibaba Cloud / DashScope. 4 sub-modes (see [Section 4](#4-happyhorse-tab-alibaba-cloud)).
   - **Image**: Seedream / Doubao image generation (not for video).
3. Configure:
   - **Generation mode**: `Reference generation` (default) or
     `First & Last Frame` (provide both endpoints, the model
     interpolates).
   - **Ratio**: 16:9, 9:16, 4:3, 3:4, 1:1, 21:9, or `Auto (adaptive)`
     which matches the active comp.
   - **Resolution**: 480p or 720p.
   - **Duration**: 5s default, max 15s (vendor cap). Switch to
     `Smart length` if you want the model to pick a duration that
     fits the prompt (still bounded by 15s).
   - **Build quantity**: how many variations to generate in this
     batch. Each variation costs the full amount: a build of 3 = 3x
     the cost shown.
   - **Output sound**: ask the model for an audio track.
     Experimental; quality varies.
   - **Watermark**: vendor watermark in the output.
   - **Random seed**: leave `-1` for fresh randomness, or fix a number
     to reproduce a specific take.
4. (Optional) Drop reference images, videos, or audio into the
   **Reference Images** slots at the bottom of the panel. The plugin
   uploads them to a temporary host (`tmpfiles.org`, ~60 min
   retention) and passes the URLs to the vendor. See the privacy note
   in the [README](../README.md#what-it-does-not-do) before using
   this for NDA work.
5. Write your prompt in the **Prompt** box. To refer to references in
   the prompt, type `[Image 1]`, `[Image 2]`, `[Video 1]`,
   `[Audio 1]` etc. Or click the chip above the textarea to insert
   the reference token at the cursor.
6. (Optional) Use the **Prompt Assistant 2.0** below. Paste a rough
   idea, click **Fast** (one-shot rewrite) or **Refined**
   (actor / critic loop, slower, better). Powered by GLM-4 via Z.AI.
7. Check the **estimated cost** in the top-right of the Configure
   block. The formula is documented in [README](../README.md#what-it-does).
8. Click **Generate**. Watch the task progress in the panel.
9. When the shot is ready, click it once: it downloads, imports into
   AE, and drops on the comp at the current playhead. Done.

### Cost discipline

The **Spending tracker** at the top of the panel logs every
generation against a lifetime total (stored locally only, no
phone-home). Treat it as a sanity check at end of each editing
session.

To keep cost low while iterating:
- Use Fast tier ($5.60/M tok) for tests.
- Stay at 480p until the prompt is settled, then re-render at 720p.
- Stay at 5s duration. The model often "stretches" a moment that
  works in 5s and breaks at 10s+.

---

## 3. History tab

Every generation gets logged in **History**: prompt, model, parameters,
output path, cost, and a thumbnail. Click an entry to:
- Re-import the clip into the current comp at the playhead.
- Re-use the prompt as the starting point for a new generation
  (the **Use this prompt** button under the assistant flow).
- Open the local file in your OS file manager.

History is stored in `localStorage` under `seedance_history`. Nuke it
from Settings if it gets noisy.

---

## 4. HappyHorse tab (Alibaba Cloud)

🐎 HappyHorse 1.0 is the plugin's name for Alibaba DashScope's video
models (Tongyi Wanx family). Useful when ARK queues are slow or for
region-specific routing.

Four sub-modes (radio buttons inside the tab):

| Sub-mode      | Model ID                       | Input you provide                  |
|---------------|--------------------------------|------------------------------------|
| Text > Video  | `happyhorse-1.0-t2v`           | Prompt only                        |
| First Frame   | `happyhorse-1.0-i2v`           | Image + prompt                     |
| References    | `happyhorse-1.0-r2v`           | Multiple reference images + prompt |
| Video Edit    | `happyhorse-1.0-video-edit`    | Source video URL + prompt          |

The `Video Edit` sub-mode requires the input video to be a public
HTTPS URL. If you drop a local file in, the plugin auto-uploads it
through `tmpfiles.org`. See the privacy note before using on NDA
content.

Region picker (CN / Intl / US) lives in Settings. Pick the one closest
to where your DashScope account is billed.

---

## 5. Storyboarder panel (in development)

> The Storyboarder panel is still under active development. Core flow
> works, but expect rough edges. See the [README note](../README.md#-storyboarder-companion-panel).

Two workflows: **build from scratch** or **scan an existing animatic**.

### 5a. Build from scratch

1. Open **Window > Extensions > Storyboarder**.
2. Configure keys: the Storyboarder panel manages its own ARK and
   Z.AI keys, **separate from the main panel**. The warning bar at
   the top tells you what's missing. Click **Open Settings** and
   paste the keys there.
3. (Optional) Describe your spot in the **Storyboard Assistant** on
   the left (e.g. *"30s ad for a red ring, sensual mood, 6 shots"*)
   and click **Generate shots**. GLM via Z.AI drafts a shot list.
   You can also start blank and add shots manually with `+ Shot`.
4. (Optional) Upload a **Visual reference** at the top:
   - **Anchor: Character**: the reference face/figure stays
     consistent across all generated shots.
   - **Anchor: Setting**: the reference environment stays consistent
     across shots.
   - Uses Seedream 5 image-to-image under the hood.
5. For each shot card:
   - First frame: optionally drop an image (image-to-video).
   - Last frame: optionally drop another image (first-and-last
     interpolation).
   - **Shot prompt**: action, camera move, mood.
   - Per-shot settings: resolution, ratio, duration (4-15s integer),
     audio, fixed cam, return last frame.
   - Click **Generate** to render one shot, or **Generate all** at
     the top to batch the whole storyboard.
6. The horizontal pink/orange bar above the cards shows the timeline
   layout: total seconds, per-shot lengths.
7. When ready, **Place ready clips** drops every rendered shot onto
   the active AE comp at the right in-points.

### 5b. Scan from AE work area

If you already laid down a series of stills (placeholders / mood-board
frames) on the AE timeline as an animatic:

1. In AE, define the work area (B / N keys) around the stills.
2. In Storyboarder, click **Sync from AE work area**. The panel reads
   each still + its in/out points and creates a shot card for each.
3. Each card auto-fills the first-frame slot with the still it
   scanned. Type a prompt per shot.
4. Click **Generate all**. Go make coffee.
5. When renders arrive, click **Place ready clips** (or **Replace
   placeholders** if available in your build). Each still gets
   swapped with its MP4 at the **same in-point**. The animatic
   becomes the cut.

### 5c. Cross-shot consistency

Two toggles to keep characters / locations stable across shots:
- **Chain frames** (top right of the shot list): each shot's last
  frame becomes the next shot's first frame. Cheap, brittle for
  long sequences.
- **Visual reference** (top of the panel): one image, all shots see
  it. More expensive (Seedream 5 image-to-image per shot) but more
  reliable.

---

## 6. Settings panel

| Field                | Where it lives in `localStorage`  | What it does                                             |
|----------------------|-----------------------------------|----------------------------------------------------------|
| ARK API key          | `seedance_ark_key`                | BytePlus ARK auth. Required.                             |
| Z.AI API key         | `seedance_zai_key`                | Prompt Assistant + Storyboard Assistant.                 |
| fal.ai API key       | `seedance_fal_key`                | Depth + Pose preprocessors.                              |
| Alibaba key + region | `seedance_alibaba_key`, `seedance_hh_region` | HappyHorse routes.                            |
| Model tier           | `seedance_model`                  | `standard` or `fast`.                                    |
| Output directory     | `seedance_output_dir`             | Where MP4s are downloaded before import.                 |
| Auto-host references | `seedance_auto_host`              | Auto-upload local refs through `tmpfiles.org`.           |
| Lifetime spend       | `seedance_total_spent`            | Local-only running total in USD.                         |

To wipe everything, clear `localStorage` for the panel (Settings >
**Reset all**) or manually in the CEP devtools console.

---

## 7. Workflow recipes

### "Hero shot": one perfect 5s clip

1. Main panel > Video 2.0 tab.
2. 720p, 16:9, 5s, Standard model.
3. Prompt Assistant > Refined.
4. Build quantity 2-3 (keep the best, delete the rest from History).
5. Cost: ~$0.75 to $2.25 per session.

### Style-locked spot, 6 shots

1. Storyboarder.
2. Generate or upload a Visual reference image for **Character** or
   **Setting** anchor.
3. Draft 6 shot prompts (either by hand or via the Storyboard
   Assistant).
4. Generate all.
5. Place ready clips.
6. Cost at 720p / 5s each: ~$4.50 (6 x $0.75).

### Match the look of an existing edit (Depth / Pose ControlNet)

1. Main panel > Video 2.0 tab.
2. Drop the reference clip into Reference Images.
3. Settings > make sure fal.ai key is set.
4. Use the Depth preprocessor on the reference to get a
   depth-map video, drop that on the AE timeline as a guide layer.
5. (Optional) Same flow with the Pose preprocessor (DWPose).
6. Generate with the original reference clip + your prompt.

### Iterate on a prompt at minimum cost

1. 480p, 5s, Fast tier.
2. Random seed `-1` (always fresh).
3. When the wording stabilizes, fix the seed (note it from History)
   and switch to 720p + Standard for the final.

---

## 8. Troubleshooting

**Panel says "AE: No comp" even though a comp is open.**
The panel polls every 3 seconds. Click in the comp viewer to make
sure AE has it as the active item, wait a few seconds. If still
stuck, close the panel and reopen it from Window > Extensions.

**Generation stays at "queued" forever.**
ARK queues spike during peak hours, especially evening CN time.
Wait, or switch to HappyHorse / Fast tier. If a job is genuinely
stuck, find it in History and click **Cancel** if the button is
exposed, or just ignore it: the cost is charged on completion, not
on queue entry.

**Shot lands at the wrong timestamp.**
The drop happens at the current playhead position. Move the
playhead before clicking the clip in History.

**"Video Edit" mode fails with "URL required".**
HappyHorse video-edit needs an HTTPS URL. If you dropped a local
file, check Settings > **Auto-host references** is enabled, or
upload the file manually somewhere and paste the URL.

**Reference image not influencing the output.**
The order of references in the prompt matters: `[Image 1]` is the
strongest, `[Image 2]` etc weaker. Vendor-specific. Re-order in the
panel before generating.

**Output looks watermarked.**
The Watermark toggle is on. Settings > turn it off.

**Cost estimate looks too high before generating.**
Build quantity > 1 multiplies cost. Drop it to 1, run, then
re-generate variations one at a time if needed.

---

## 9. Power-user tips

- **Fix the seed early.** Random seeds make every "improve the prompt"
  iteration noisy. Once a take has the right composition, lock the
  seed and only change words.
- **Storyboarder for animatic preview.** Even without rendering, the
  pink/orange timeline bar gives you the per-shot length distribution
  of the whole spot. Useful for pacing checks before spending money.
- **Re-use cached refs.** Once a reference image is uploaded to
  `tmpfiles.org`, the URL is good for ~60 min. Reuse it across
  generations within that window to skip the upload.
- **Keep an "approved prompts" file.** When a prompt produces a great
  result, save it externally (the History only holds recent runs).
  The wording style for Seedance 2.0 isn't quite English: cinematic
  shorthand ("low angle dolly-in, golden hour, anamorphic 2.39:1")
  works better than long sentences.
- **The 15s cap is per generation, not per shot.** Multi-shot stories
  can exceed 15s by using Storyboarder (each shot is its own 15s
  budget).

---

## 10. Where to ask for help

- **Bug**: open an issue using the [bug template](../.github/ISSUE_TEMPLATE/bug_report.md).
- **Feature**: [feature template](../.github/ISSUE_TEMPLATE/feature_request.md).
- **Security**: do **not** open a public issue. Email
  `info@homolapis.ai`. See [SECURITY.md](../SECURITY.md).
- **Custom build / training / priority support**: `info@homolapis.ai`.
  See the *Commercial & support* section in the
  [README](../README.md#commercial--support).
