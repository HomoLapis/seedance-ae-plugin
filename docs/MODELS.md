# Supported models

This file is the truth about which engines the plugin can talk to.
Everything else (pricing, docs) lives upstream.

## BytePlus ARK: Seedance 2.0  ← the default

| Model ID                             | Mode      | $/M tokens |
|--------------------------------------|-----------|------------|
| `dreamina-seedance-2-0-260128`       | Standard  | $7.00      |
| `dreamina-seedance-2-0-fast-260128`  | Fast      | $5.60      |

Picked via the `seedance_model` localStorage key (`"standard"` /
`"fast"`); see `frontend-src/src/api.js`.

Token formula (no video input):
```
tokens = (width × height × 24 × duration_sec) / 1024
cost   = tokens / 1_000_000 × price_per_M
```

Hard cap: **15 s per generation**. Vendor limit, not ours.

Endpoint: `https://ark.ap-southeast.bytepluses.com/api/v3`
Console / billing: https://console.byteplus.com/ark

## Z.AI: GLM-4 flash (optional, prompt assistant)

Used only for the "Improve my prompt" button. Optional. If you don't set
a key, the plugin still works, you just won't get prompt rewriting.

Endpoint: `https://api.z.ai/api/paas/v4/chat/completions`

## FAL: preprocessors (optional)

Two video preprocessing endpoints are wired up. Both take a public
HTTPS URL as input and return a processed video URL that you can
download / drop on the AE timeline as an extra layer (typical use:
ControlNet-style guidance for downstream generation, or matchmove /
keying reference).

| What you ask for     | fal.ai endpoint                      | Notes                                                            |
|----------------------|--------------------------------------|------------------------------------------------------------------|
| **Depth map video**  | `fal-ai/depth-anything-video`        | Depth Anything (DAv2). Grayscale per-frame depth.                |
| **Pose / skeleton**  | `fal-ai/dwpose/video`                | DWPose, modern OpenPose replacement. Same downstream use case.   |

Both are queued jobs: the panel polls the FAL queue and downloads the
output when ready. Implementation in `frontend-src/src/api.js`,
`generateDepthVideo()` and `generateOpenPoseVideo()`.

Base endpoint: `https://queue.fal.run/<model>`

## Alibaba DashScope: HappyHorse 1.0 (optional)

🐎 **HappyHorse 1.0** is the plugin's name for the Tongyi Wanx /
DashScope video models. Four modes are exposed:

| Mode          | Model ID                             | Input                                |
|---------------|--------------------------------------|--------------------------------------|
| Text → Video  | `happyhorse-1.0-t2v`                 | Prompt                               |
| First Frame   | `happyhorse-1.0-i2v`                 | Image + prompt                       |
| References    | `happyhorse-1.0-r2v`                 | Multiple reference images + prompt   |
| Video Edit    | `happyhorse-1.0-video-edit`          | Source video (HTTPS URL) + prompt    |

Region selector in Settings (CN / Intl / US): pick the endpoint
closest to your billing region:

- `https://dashscope.aliyuncs.com`      (CN)
- `https://dashscope-intl.aliyuncs.com` (Intl)
- `https://dashscope-us.aliyuncs.com`   (US)

The `video-edit` mode requires the input to be a **public HTTPS URL**
(no base64): the plugin auto-uploads local videos via tmpfiles.org
if needed (see *Image upload for references* below).

## Image upload for references

Reference images are uploaded to `tmpfiles.org` (auto-expiring, ~60 min
retention, 100 MB max) and the returned URL is passed to the vendor. If
that's not OK for your security policy, fork and replace
`uploadFileToTempHost()` in `frontend-src/src/api.js` with your own
bucket / signed URL service.
