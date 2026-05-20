/**
 * Seedance Studio — Direct API client
 * Calls BytePlus ModelArk and Z.AI directly from the CEP panel.
 * No backend required. API keys stored in localStorage.
 *
 * Seedance 2.0 model IDs (BytePlus ModelArk pricing page):
 *   Standard : dreamina-seedance-2-0-260128
 *   Fast     : dreamina-seedance-2-0-fast-260128
 *
 * GLM models (Z.AI prompt assistant):
 *   Text-only : glm-5
 *   Vision    : glm-4.6v
 *
 * Seedream image editing:
 *   Model     : seedream-5-0-260128
 */

const BYTEPLUS_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";

// Seedance 2.0 model IDs
const MODELS = {
  standard: "dreamina-seedance-2-0-260128",
  fast:     "dreamina-seedance-2-0-fast-260128",
};

function getModel() {
  const saved = localStorage.getItem("seedance_model") || "standard";
  return MODELS[saved] || MODELS.standard;
}

// Z.AI
const ZAI_BASE_URL    = "https://api.z.ai/api/paas/v4/chat/completions";
const ZAI_MODEL_TEXT   = "glm-5";
const ZAI_MODEL_VISION = "glm-4.6v";

// Image resize limits (matches backend logic)
const MAX_IMAGE_PX    = 1024;
const MAX_IMAGE_BYTES = 1 * 1024 * 1024;

// ── Prompt guide — Seedance 2.0 (based on official BytePlus tutorial) ────────
const SEEDANCE_GUIDE = `You are a professional prompt engineer for Seedance 2.0 / 2.0 fast (BytePlus ModelArk,
dreamina-seedance-2-0-260128). Rewrite the user's request into an optimized, production-quality
English prompt that maximizes the probability the model follows the user's intent. Preserve ALL
the user's concrete ideas; only improve the wording and add Seedance-specific structure.

The rules, formulas, vocabulary, and examples below are taken VERBATIM from the official
Seedance 2.0 series tutorial (ModelArk docs, tutorial ID 1776173957). Follow them exactly.

═══════════════════════════════════════════════════════════════════════════════
1. HOW THE MODEL SEES REFERENCES (CRITICAL)
═══════════════════════════════════════════════════════════════════════════════

The API accepts up to:
  - 0-9 reference images   (role "reference_image")
  - 0-3 reference videos   (role "reference_video")
  - 0-3 reference audios   (role "reference_audio")
Combined reference modes supported: image; video; image+audio; image+video;
video+audio; image+video+audio. NOT supported: "text+audio" alone, "audio-only".

"Prompts must reference assets in the format asset type + number, where the number is
the sorting order of the asset among assets of the same type in the request body.
For example, 'Image n' refers to the nth reference image with type='image_url' in the
content array (counting starts from 1 in array order). Note that referencing assets by
Asset ID is NOT supported."

  CORRECT   → "Beauty influencer in Image 1", "Replace the cat in [Video1] with the lion from [Image1]"
  INCORRECT → "asset-2026**** is a beauty influencer"

The model understands ALL of these citation forms (mixable within one prompt):
  Image 1   [Image 1]   [Image1]   (Image 1)   image 1
Use whichever reads naturally. Brackets \`[Image 1]\` tend to give the most reliable
adherence in long prompts and are the form used in most official examples. Be
consistent within a single prompt.

Inheritance semantics — what each reference contributes:
  - Reference images  → character appearance, object details, visual style, screen composition
  - Reference videos  → subject identity, camera movement, action performance, overall style, special effects
  - Reference audios  → voice timbre, music melody, dialogue content

═══════════════════════════════════════════════════════════════════════════════
2. OFFICIAL PROMPT FORMULAS (from the tutorial, verbatim)
═══════════════════════════════════════════════════════════════════════════════

Image reference:
  "Reference / extract / combine [subject or referenced-element description] from
   Image n to generate [plot description], keeping the characteristics of
   [subject/referenced element] consistent."

Video reference:
  "Reference [action description / camera-movement description / special-effect
   description] from Video n to generate [plot description], keeping the
   [action details / camera movement / special effects] consistent."

Audio reference — voice timbre:
  "[Character] says: '[dialogue lines]', voice timbre references Audio n."

Audio reference — content / sync (music / sfx):
  "[Ideal timing or mood context], using Audio n as background music throughout."
  or  "synced to the rhythm of Audio n."

Edit video (the reference_video is the clip being edited):
  - Add elements:    "Clearly describe element characteristics + appearance timing + appearance position."
  - Delete elements: "Specify the elements to be deleted, and emphasize the elements
                     that remain unchanged for a better result."
  - Modify elements: "Simply clearly describe the elements to be replaced."
  Example (from docs): "Replace the cat in [Video1] with the lion from [Image1]. The lion
  lies on its side across the girl's legs, gently interacting with her in a warm and tender way."

Extend video (single-clip extension):
  "Extend Video n forward/backward, [description of new content], and connect back to
   Video n at the end."

Track completion (stitch 2-3 clips):
  "Video 1 [transition description], transitioning into Video 2; Video 2 [transition
   description], transitioning into Video 3."

═══════════════════════════════════════════════════════════════════════════════
3. BASIC SCENARIOS (no omni-references)
═══════════════════════════════════════════════════════════════════════════════

Text-to-video (t2v):
  Subject + action/motion + camera movement + environment + mood/style.
  Use temporal segmentation for complex scenes: "0-2s: ... ; 2-4s: ... ; 4-6s: ...".

Image-to-video — first frame only (Image 1 is the starting frame, role=first_frame):
  Describe the motion and action that BEGINS from the state shown in Image 1. Do NOT
  redescribe the image — describe what happens and how the scene moves from that state.
  Formula: "[What happens / subject action], starting from Image 1, [camera movement], [lighting/mood]."

Image-to-video — first + last frame (strict first/last frame mode):
  Describe the visual transition, motion, and transformation between the two states.
  Formula: "Starting from Image 1, [motion and change], ending at Image 2."

═══════════════════════════════════════════════════════════════════════════════
4. CAMERA, MOTION, DIALOGUE — VOCABULARY THE MODEL KNOWS
═══════════════════════════════════════════════════════════════════════════════

Camera movement:         pan, tilt, dolly in/out, push-in, pull-back, tracking shot,
                         crane shot, orbit, arc shot, POV, first-person POV, handheld,
                         cockpit cam, over-the-shoulder, extreme close-up, wide shot,
                         fixed-camera.
Motion qualifiers:       slowly, gently, suddenly, wildly, gracefully, steadily,
                         in slow motion, frame stepping, motion blur, rapid cuts.
Lighting / atmosphere:   golden hour, soft diffused lighting, dramatic side-lighting,
                         cinematic night, neon bokeh, rim light, volumetric light.
Dialogue & speech:       'Character says: "line"' — enclose the spoken line in quotes.
                         Specify voice: "female voice", "male voice, calm and authoritative".
                         For lip-sync hints: "lips tremble slightly", "pupils shake".
VFX / physics:           particle continuity, debris trajectory, fur physics simulation,
                         fabric falls like cloth, limbs maintain integrity.

═══════════════════════════════════════════════════════════════════════════════
5. CONTROLNET-STYLE REFERENCE VIDEOS (plugin-specific)
═══════════════════════════════════════════════════════════════════════════════

A reference video may be a structural preprocessor output rather than raw footage:
  - Depth map  → grayscale near=light / far=dark. Guides 3D structure, camera path,
                 scene geometry. Identity is NOT preserved.
  - Pose map   → stick figure on black (DWPose / OpenPose). Guides body motion and
                 choreography only. Appearance comes from elsewhere.

When a depth or pose video is attached, prefer wording like:
  "Reference the camera path and scene depth from Video 1, applied to [new subject/scene]."
  "Reference the body motion and pose from Video 1, performed by the character in Image 1."

DO NOT describe the depth/pose video's literal grayscale or skeleton appearance —
describe the FINAL scene the user wants.

═══════════════════════════════════════════════════════════════════════════════
6. CANONICAL OFFICIAL EXAMPLES (from the BytePlus tutorial, verbatim)
═══════════════════════════════════════════════════════════════════════════════

--- Example A: multimodal (Image + Video + Audio) ---
"Use the first-person POV framing from Video 1 throughout, and use Audio 1 as the
background music throughout. First-person POV fruit tea promotional ad, seedance
limited-edition apple fruit tea; opening frame is Image 1, your hand picks a
dew-covered Aksu red apple, a light, crisp apple tapping sound; 2-4 seconds: fast
cuts, your hand drops apple chunks into a shaker, adds ice and tea base, shakes
forcefully, ice clinking and shaking sounds sync with upbeat rhythmic beats,
background audio: {Fresh-cut, shaken fresh}; 4-6 seconds: first-person close-up of
the finished drink, layered fruit tea is poured into a clear cup, your hand gently
squeezes milk foam to spread across the top, a pink brand sticker is applied to the
cup, the camera moves closer to show the layered textures of the foam and fruit tea;
6-8 seconds: first-person hand-held toast shot, you raise the fruit tea from Image 2
toward the camera (simulating handing it to the viewer), the cup label is clearly
visible, background audio {Take a sip of fresh refreshment}, the final frame freezes
on Image 2. All background voice audio uses a female voice."

--- Example B: video editing (replace subject) ---
"Replace the cat in [Video1] with the lion from [Image1]. The lion lies on its side
across the girl's legs, gently interacting with her in a warm and tender way."

--- Example C: extend / stitch ---
"The arched window in [video 1] opens, and the camera moves into the interior of
the art museum, transitioning into [video 2]. After that, the camera enters the
painting itself, transitioning into [video 3]."

--- Example D: digital-character product ad with dialogue ---
"Vertical HD close-up video of a beauty blogger (Image 1). She has bold, glamorous
makeup with no facial shine or glare and a sweet smile. She holds a face cream jar
(Image 2), presents it directly to the camera. The background is fresh and minimalist.
Energetic and sweet style. Character speaks in real-time: 'I found my holy grail face
cream! It has a cloud-like creamy texture that absorbs instantly. Perfect for
post-all-nighter rescue, deep hydration and moisturization — my skin glows naturally
even without makeup!'"

═══════════════════════════════════════════════════════════════════════════════
7. ABSOLUTE RULES
═══════════════════════════════════════════════════════════════════════════════

- OUTPUT ONLY the final prompt text — no labels, no explanations, no markdown,
  no surrounding quotes.
- English only. If the user writes in another language, translate meaning-preserving.
- Preserve ALL user intentions, subjects, actions, named objects — improve only the WORDING.
- DO NOT invent new characters, objects, or plot elements the user did not request.
- DO NOT describe static scenes without motion — always make something happen.
- WHEN references are attached, you MUST cite them as [Image n] / [Video n] / [Audio n]
  using the same number as the slot position shown to you in the user's request. NEVER
  cite an asset by its raw ID.
- For references, focus on describing CHANGE, MOVEMENT and HOW to use them — not on
  redescribing the reference's static appearance.
- For videos >= 10 seconds, prefer a 2-3 shot timeline breakdown with timestamps
  (e.g. "0-4s: ... ; 4-8s: ... ; 8-12s: ...") unless the user explicitly wants a single
  continuous take.
- Aim for 80-200 words for complex multimodal prompts; shorter for simple requests.
- Prompt length hard limit per docs: English prompts should NOT exceed 1000 words.`;

// ── Seedance 1.5 Pro prompt guide (verbatim from official ByteDance docs) ──
//
// Source: BytePlus / Volcengine "Seedance-1.5-pro Prompt Guide"
// (also mirrored at https://fal.ai/learn/devs/seedance-1-5-prompt-guide).
//
// 1.5 Pro is fundamentally different from 2.0:
//   - It does NOT support omni-references (no reference_image / reference_video /
//     reference_audio roles).
//   - It DOES support: Text-to-Video, Image-to-Video (first frame),
//     Image-to-Video (first + last frame), and Draft sample mode.
//   - Native joint audio-video generation: dialogue (multi-speaker, multi-language
//     including Chinese, English, Japanese, Korean, Spanish, Indonesian, plus
//     dialects: Cantonese, Sichuan, Shaanxi, Taiwanese), SFX, BGM all driven by
//     the prompt.
//   - Hard limit: prompt ≤ 1000 words; supports CN + EN.
//
const SEEDANCE_15_GUIDE = `You are a professional prompt engineer for Seedance 1.5 Pro
(BytePlus ModelArk, model ID seedance-1-5-pro-251215). Rewrite the user's request
into an optimized English prompt that maximizes the model following the user's intent.

The rules, formula, vocabulary, and examples below are taken VERBATIM from the
official Seedance 1.5 Pro prompt guide. Follow them exactly.

═══════════════════════════════════════════════════════════════════════════════
1. WHAT MAKES 1.5 PRO DIFFERENT FROM 2.0 (CRITICAL)
═══════════════════════════════════════════════════════════════════════════════

1.5 Pro is a foundational model purpose-built for NATIVE, JOINT audio-video
generation. Unlike 2.0, it does NOT accept reference_image / reference_video /
reference_audio attachments. Supported scenarios:

  - Text-to-Video                     (prompt only)
  - Image-to-Video — first frame      (1 image with role=first_frame)
  - Image-to-Video — first+last frame (2 images with first_frame / last_frame roles)
  - Draft sample mode                 (low-cost preview, 480p only)

Therefore: NEVER cite "[Image n]" or "[Video n]" or "[Audio n]" in a 1.5 Pro
prompt. The model has no notion of slot citation. Audio (dialogue / SFX / BGM)
is generated NATIVELY from the textual description in the prompt.

═══════════════════════════════════════════════════════════════════════════════
2. OFFICIAL PROMPT FORMULA (verbatim)
═══════════════════════════════════════════════════════════════════════════════

  Subject + Movement + Environment (optional) + Camera movement (optional)
  + Aesthetic description (optional) + Sound (optional)

By detailing dialogue content, language choices, emotional progression, camera
movement, and narrative structure, the model generates audio and visuals more
closely aligned, meeting professional audio-visual synchronization needs.

Basic principles:
  - Provide clear, constrained descriptions of the subject and motion.
  - Specify the key visual cues the scene should convey.
  - Use degree adverbs effectively ("slowly", "powerfully", "gently").
  - Prompt must align accurately with both visual content AND audio.
  - Use feature-based descriptions to define the subject CONSISTENTLY across the prompt.

═══════════════════════════════════════════════════════════════════════════════
3. AUDIO GENERATION (1.5 Pro's signature capability)
═══════════════════════════════════════════════════════════════════════════════

a) DIALOGUE / VOICEOVER — high voice timbre stability
   "[Emotional state], with [tone description] and a [pace] speaking pace, say:
    \\"<dialogue line>\\""

   Example (verbatim):
   "In a calm emotional state, with an even tone and a normal speaking pace,
    say: 'Let's begin with what matters most.'"

b) MULTI-LANGUAGE / DIALECTS supported:
   Chinese (Mandarin + Cantonese, Sichuan, Taiwanese, Shaanxi),
   English, Japanese, Korean, Spanish, Indonesian.
   Format: "He said in <Language>: '<line in that language>'" or "<Language> dialogue:".

c) MULTI-PERSON DIALOGUE — millisecond-level lip-sync.
   Specify each character by gender + age + clothing + actions, then label lines:
     White female: "..."
     Black male:   "..."
     Asian female: "..."
   The lip-sync engine binds lines to the visually identified speakers.

d) RESPONSIVE VOICEOVER (documentary / commercial style):
   "A <deep|warm|clear> <male|female> <commercial|documentary> voice with a
    <refined|calm|energetic> tone and a <moderate|fast|slow> speaking pace
    delivers the following lines: '<line>'"

e) SOUND EFFECTS (SFX): describe the action that generates the sound — the model
   produces the matching SFX automatically. Example: "huge waves crashing", "a
   fuel depot exploded with a fireball soaring", "raindrops merging into streams
   on the glass".

f) BACKGROUND MUSIC (BGM): by default 1.5 Pro auto-generates BGM matching the
   prompt. To control:
     - Style:  "accompanied by a heart-stirring symphony as background music"
     - Pacing: "this cartoon character claps hands in time with the drumbeats of
                the music"
     - Mood:   "the background music should be a gentle, nostalgic, melodious
                guitar or piano solo"

═══════════════════════════════════════════════════════════════════════════════
4. SHOT / TRANSITION WRITING (verbatim from docs)
═══════════════════════════════════════════════════════════════════════════════

  - Supports consistent style before and after camera switching (Disney /
    Pixar / Realistic across cuts).
  - Supports REVERSE-SHOT editing for dialogue scenes (Shot A → Shot B → back to A).
  - Supports timing-driven shot switching, structured as:

      Shot 1: <starting frame composition>. <action / dialogue>.
      Shot 2: <cut description, camera>. <action / dialogue>.
      Shot 3: <camera>. <action>.
      ...

  Example template:
    "The shot starts with a medium-long shot of the interior, where the natural
     light of the evening shines in through the window. ... The shot cuts to a
     medium shot, where he glances down at the phone screen. ... The shot cuts
     to a close-up of his hand. ... The shot cuts to a close-up of his profile,
     where he gently exhales and whispers: 'I think I'll skip it.' ..."

═══════════════════════════════════════════════════════════════════════════════
5. ADVANCED — STYLE / LENS / EFFECTS
═══════════════════════════════════════════════════════════════════════════════

a) AESTHETIC STYLE — anchor with a clear stylistic reference.
   Example phrasings (verbatim):
     "Imitate the style of the Japanese drama 'Little Forest' to generate ..."
     "Imitate the style of Hayao Miyazaki's anime to generate ..."
     "Referring to the style of Disney's 2D animated movies, generate ..."

b) LENS — use photographic terminology correctly.

   Camera angle:        High Angle / Low Angle / Bird View / Eye-level / Top-down
   Narrative POV:       Over-the-Shoulder / Subjective / Surveillance / Telescope
                        / Ant Perspective / Peeping
   Subject angle:       Front / Profile / Half-Profile / Back / Top / Bottom

   View / shot size (standard grammar: "Subject + Shot Size", e.g. "Close-up of
   the man on the left", "A bust of the woman in red"):
     Photography: wide shot / full shot / medium shot / close up shot / big close-up
     Art:         headshot / bust / half-length portrait / full-length portrait

   Camera movement formula:
     "Starting frame composition + Shot movement + Movement amplitude + Ending
      frame composition"
   Movements:
     dolly-in, dolly-out, pan, track, follow, rise, fall, whirl, rotate, surround,
     zoom. Combinations like "Hitchcock shot = dolly-in/out + zoom-out/in" and
     "Bullet time = time slowdown + surround" are supported.

c) EFFECTS / GAMEPLAY — describe explicitly:
   - The trigger timing ("She inadvertently touched the old Christmas ball with her
     finger, and instantly...")
   - The transformation process ("its body gradually elongating", "fur evolves into
     fluffy orange short hair")
   - The details after transformation
   - The audio design that accompanies the effect

═══════════════════════════════════════════════════════════════════════════════
6. CANONICAL OFFICIAL EXAMPLES (verbatim from docs — emulate, do not copy)
═══════════════════════════════════════════════════════════════════════════════

--- Example 1.5-A (subject + emotional motion) ---
"A man with a weathered face and dressed in medieval pirate costumes stands on
the black reef by the sea. The man's expression is passionate, and he raises
his hands powerfully toward the sky, revealing a desire for freedom."

--- Example 1.5-B (multi-character English dialogue, two-person) ---
"In a warm, softly lit independent bookstore, two Americans — a man and a woman
— stand shoulder to shoulder, flipping through the same book. The light falls
across the pages and their faces. The camera makes an extremely subtle dolly-in,
creating a quiet and intimate atmosphere.
English dialogue:
Man:   'Did you ever read this one before?'
Woman: 'No, but… I think I want to, with you.'"

--- Example 1.5-C (commercial voiceover + product) ---
"Generate a video based on the input lipstick product keyframe image, keeping
the appearance, proportions, and materials of both the lipstick and the model
accurate and consistent. The overall style is a high-end e-commerce beauty
commercial, clean, refined, and premium in tone. The video consists of three
continuous shots: <shot1, shot2, shot3 descriptions>. A clear, confident female
commercial voice-over with a refined tone and moderate speaking pace is
synchronized with the visuals, delivering the following lines: 'Rich color.
Smooth texture. One swipe delivers radiant lips. Lightweight, comfortable, and
effortlessly elegant.'"

--- Example 1.5-D (lens control: Hitchcock zoom) ---
"A close-up shot shows a girl with glasses and well-defined features, dyed
short red hair, frowning, looking straight into the camera. The background is
a dilapidated amusement park. Hitchcockian camera movement: keep the girl's
main composition unchanged, dolly out + increase the focal length of the lens."

═══════════════════════════════════════════════════════════════════════════════
7. ABSOLUTE RULES
═══════════════════════════════════════════════════════════════════════════════

- OUTPUT ONLY the final prompt text — no labels, no explanations, no markdown,
  no surrounding quotes.
- English (or Chinese if the user explicitly wants a CN dialect).
- Preserve ALL user intentions, subjects, actions, named objects.
- DO NOT invent new characters, objects, or plot elements the user did not request.
- DO NOT cite "[Image n]" / "[Video n]" / "[Audio n]" — 1.5 Pro has no slot system.
- For DIALOGUE, write speakers explicitly with character labels and put each line
  in single quotes. Specify language if it is not English.
- For >= 10 second videos, prefer a 2-3 shot timeline using "Shot 1: ... Shot 2: ...".
- Use the formula Subject + Movement + Environment + Camera + Aesthetic + Sound.
- Prompt length hard limit per docs: ≤ 1000 words.`;

function getArkKey() {
  return localStorage.getItem("seedance_ark_key") || "";
}

function getZaiKey() {
  return localStorage.getItem("seedance_zai_key") || "";
}

// ── Image resize for GLM ────────────────────────────────────────────────────

function resizeImageForGLM(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith("data:")) return Promise.resolve(dataUrl);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;

      if (w > MAX_IMAGE_PX || h > MAX_IMAGE_PX) {
        const scale = MAX_IMAGE_PX / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);

      for (const quality of [0.85, 0.70, 0.55, 0.40]) {
        const result  = canvas.toDataURL("image/jpeg", quality);
        const b64data = result.split(",")[1] || "";
        const bytes   = Math.round(b64data.length * 3 / 4);
        if (bytes <= MAX_IMAGE_BYTES) {
          resolve(result);
          return;
        }
      }
      resolve(canvas.toDataURL("image/jpeg", 0.40));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ── BytePlus API ────────────────────────────────────────────────────────────

/**
 * Create a Seedance 2.0 video generation task on BytePlus ModelArk.
 * Returns { task: { id, status, ... } }
 *
 * params:
 *   prompt               string   — video description
 *   resolution           string   — "480p" | "720p"
 *   ratio                string   — "16:9" | "9:16" | "4:3" | "3:4" | "1:1" | "21:9"
 *   duration             number   — 4–15
 *   camera_fixed         boolean
 *   generate_audio       boolean
 *   seed                 number   — -1 for random
 *   draft                boolean  — 480p preview mode
 *
 *   — Image-to-Video (first frame):
 *   first_frame_upload_id  string | null  — base64 data URL
 *   first_frame_url        string | null  — external URL
 *
 *   — First+Last Frame:
 *   last_frame_upload_id   string | null
 *   last_frame_url         string | null
 *
 *   — Omni-reference (multiple images, reference videos, reference audio):
 *   ref_images   string[]  — base64 or external URLs, cited as "Image 1" / "Image 2" in prompt
 *   ref_videos   string[]  — external URLs (no base64), cited as "Video 1" etc.
 *   ref_audios   string[]  — external URLs, cited as "Audio 1" etc.
 *
 *   — Sample task:
 *   sample_task_id  string | null  — ID of a previous Seedance 2.0 generation to use as reference
 *
 * NOTE: Seedance 2.0 does NOT accept a `role` field on content items.
 * Content item order determines context; the prompt must reference images explicitly
 * using BytePlus convention: "Image 1", "Image 2", "Video 1", "Audio 1" (not @image1).
 */
export async function createGeneration(params) {
  const arkKey = getArkKey();
  if (!arkKey) throw new Error("ARK API key not set — open Settings to add your key.");

  // Per official BytePlus ModelArk docs (Create-a-video-generation-task PDF,
  // page 10-11: "New method (Recommended): Pass the parameters directly in the
  // request body"), Seedance accepts generation controls as top-level body
  // fields. This method is STRICTLY validated — invalid values return an
  // error prompt (the legacy --flag form silently ignores bad values, which
  // is why `--audio false` didn't disable audio in earlier builds).
  const mode = params.mode || null;
  const firstFrame = params.first_frame_upload_id || params.first_frame_url || null;
  const lastFrame  = params.last_frame_upload_id  || params.last_frame_url  || null;
  const refVideos  = params.ref_videos || [];
  const refImages  = params.ref_images || [];
  const refAudios  = params.ref_audios || [];

  // Build content[] — prompt first, then typed references.
  // Per docs, the three scenarios are mutually exclusive:
  //   1. image-to-video (first frame): one image with role="first_frame" (or blank)
  //   2. first & last frame: two images with roles first_frame / last_frame
  //   3. multimodal reference: 1-9 reference_image, 0-3 reference_video, 0-3 reference_audio
  //      (first/last frame roles are NOT used in this scenario; cite in prompt instead)
  const content = [{ type: "text", text: params.prompt.trim() }];

  if (mode === "i2v_fl") {
    if (firstFrame) content.push({ type: "image_url", image_url: { url: firstFrame }, role: "first_frame" });
    if (lastFrame)  content.push({ type: "image_url", image_url: { url: lastFrame  }, role: "last_frame"  });
  } else if (mode === "i2v") {
    if (firstFrame) content.push({ type: "image_url", image_url: { url: firstFrame }, role: "first_frame" });
  } else {
    // "ref" or "t2v" — multimodal/text-to-video
    refImages.forEach((img) => {
      if (img) content.push({ type: "image_url", image_url: { url: img }, role: "reference_image" });
    });
    refVideos.forEach((vid) => {
      if (vid) content.push({ type: "video_url", video_url: { url: vid }, role: "reference_video" });
    });
    refAudios.forEach((aud) => {
      if (aud) content.push({ type: "audio_url", audio_url: { url: aud }, role: "reference_audio" });
    });
  }

  if (params.sample_task_id) {
    content.push({ type: "task_id", task_id: params.sample_task_id });
  }

  // Body fields (docs — Request body, pages 9-14). Use full parameter names;
  // abbreviations are not supported in body form.
  const body = {
    model:   getModel(),
    content,
    resolution:     params.resolution || "720p",
    ratio:          params.ratio      || "adaptive",
  };

  // Duration: -1 = smart length; otherwise integer in [4, 15] for Seedance 2.0.
  if (Number.isFinite(params.duration)) {
    body.duration = params.duration;
  }

  // Seed: -1 for random per docs default, 0..2^32-1 for deterministic.
  if (Number.isFinite(params.seed)) {
    body.seed = params.seed;
  }

  // Boolean fields — send as actual booleans (not strings).
  if (typeof params.generate_audio === "boolean") {
    body.generate_audio = params.generate_audio;
  }
  if (typeof params.watermark === "boolean") {
    body.watermark = params.watermark;
  }
  if (params.return_last_frame === true) {
    body.return_last_frame = true;
  }

  // camera_fixed: docs state it's "currently not supported" for Seedance 2.0,
  // but the same docs' example JSON does include it. We pass it through when
  // set so older/other models honor it — newer models will just ignore it.
  // Skip when the combo logically conflicts (both first+last set, or a
  // reference video is present).
  const hasFirstAndLast = !!(firstFrame && lastFrame);
  const hasRefVideo     = refVideos.some(Boolean);
  if (!hasFirstAndLast && !hasRefVideo && typeof params.camera_fixed === "boolean") {
    body.camera_fixed = params.camera_fixed;
  }

  const res = await fetch(`${BYTEPLUS_BASE}/contents/generations/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${arkKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err.error?.message || err.message || `BytePlus error ${res.status}: ${res.statusText}`
    );
  }

  return { task: await res.json(), estimate: null };
}

// ── Seedance 1.5 Pro (legacy video model) ──────────────────────────────────
// The 1.5 Pro model predates Seedance 2.0 and uses the OLDER body-field schema
// (NOT the --flag inline syntax). It supports 480p/720p/1080p, but does NOT
// support omni-reference (images/videos/audios as references).
//
// Supported modes: t2v, i2v (first frame), flf (first + last frame).
export const SEEDANCE_1_5_PRO_ID  = "seedance-1-5-pro-251215";
export const SEEDANCE_1_5_PRO_RESOLUTIONS = ["480p", "720p", "1080p"];
export const SEEDANCE_1_5_PRO_RATIOS      = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];

/**
 * Create a Seedance 1.5 Pro video task.
 *
 * params:
 *   prompt              string
 *   resolution          "480p" | "720p" | "1080p"
 *   ratio               "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9"
 *   duration            4..12
 *   camera_fixed        boolean
 *   generate_audio      boolean
 *   watermark           boolean
 *   seed                number (-1 random)
 *   first_frame_url     string | null  (i2v)
 *   last_frame_url      string | null  (flf)
 */
export async function createGeneration15Pro(params) {
  const arkKey = getArkKey();
  if (!arkKey) throw new Error("ARK API key not set — open Settings to add your key.");

  const content = [{ type: "text", text: params.prompt.trim() }];

  const firstFrame = params.first_frame_upload_id || params.first_frame_url || null;
  const lastFrame  = params.last_frame_upload_id  || params.last_frame_url  || null;
  if (firstFrame) content.push({ type: "image_url", image_url: { url: firstFrame }, role: "first_frame" });
  if (lastFrame)  content.push({ type: "image_url", image_url: { url: lastFrame  }, role: "last_frame" });

  const body = {
    model:          SEEDANCE_1_5_PRO_ID,
    content,
    resolution:     params.resolution     || "720p",
    duration:       params.duration       ?? 5,
    ratio:          params.ratio          || "16:9",
    generate_audio: params.generate_audio ?? false,
    watermark:      params.watermark      ?? false,
    seed:           Number.isFinite(params.seed) ? params.seed : -1,
  };
  // camera_fixed conflicts with flf mode (both first + last frame).
  if (!(firstFrame && lastFrame) && typeof params.camera_fixed === "boolean") {
    body.camera_fixed = params.camera_fixed;
  }

  const res = await fetch(`${BYTEPLUS_BASE}/contents/generations/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${arkKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || err.message || `BytePlus error ${res.status}: ${res.statusText}`);
  }
  return { task: await res.json() };
}

/**
 * Poll a task by ID.
 * Returns { task: { id, status, content: { video_url }, usage, ... } }
 */
export async function pollTask(taskId) {
  const arkKey = getArkKey();
  if (!arkKey) throw new Error("ARK API key not set.");

  const res = await fetch(`${BYTEPLUS_BASE}/contents/generations/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${arkKey}` },
  });

  if (!res.ok) throw new Error(`Poll failed: ${res.status} ${res.statusText}`);
  return { task: await res.json() };
}

/**
 * List the user's recent video generation tasks.
 * Per BytePlus docs (ModelArk "List video generation tasks"): only the last
 * 7 days of history are queryable; video_url / last_frame_url expire 24h
 * after the task succeeds (but face-containing Seedance 2.0 outputs stay
 * trusted as input assets for 30 days).
 *
 * @param {object} [opts]
 *   - pageNum / pageSize: pagination (1..500 each)
 *   - status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired"
 *   - model: exact endpoint ID filter (optional)
 *
 * Returns { items: [...], total: number }
 */
export async function listTasks(opts = {}) {
  const arkKey = getArkKey();
  if (!arkKey) throw new Error("ARK API key not set — open Settings to add your key.");

  const params = new URLSearchParams();
  if (Number.isFinite(opts.pageNum))  params.set("page_num",  String(opts.pageNum));
  if (Number.isFinite(opts.pageSize)) params.set("page_size", String(opts.pageSize));
  if (opts.status) params.set("filter.status", opts.status);
  if (opts.model)  params.set("filter.model",  opts.model);

  const url = `${BYTEPLUS_BASE}/contents/generations/tasks${params.toString() ? "?" + params.toString() : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${arkKey}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `List tasks failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return { items: data.items || [], total: data.total || 0 };
}

// ── BytePlus Files API — upload local video for reference ──────────────────

/**
 * Upload a local video file to BytePlus Files API.
 * Returns the URL to use in video_url.url (a public TOS URL).
 *
 * file: a browser File object (from <input type="file"> or drag-and-drop)
 */
/**
 * Upload a local video to tmpfiles.org and return a public HTTPS URL (~60 min retention).
 * BytePlus requires a public URL for video references — this is the fastest path.
 * User can disable this in Settings and fall back to local-save + manual paste.
 */
export async function uploadVideoToTempHost(file) {
  return uploadFileToTempHost(file, { fallbackName: "video.mp4", fallbackMime: "video/mp4" });
}

/**
 * Generic tmpfiles.org uploader. Used for videos AND images on the HappyHorse
 * code path, since DashScope's HappyHorse endpoints accept ONLY public URLs
 * (no base64) for both image and video inputs.
 *
 * Returns a direct-download HTTPS URL valid ~60 minutes.
 */
export async function uploadFileToTempHost(file, opts = {}) {
  const MAX = 100 * 1024 * 1024;
  if (file.size > MAX) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). tmpfiles.org max 100 MB.`);
  }
  const safeName = (file.name || opts.fallbackName || "file.bin").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  const renamed = new File([file], safeName, { type: file.type || opts.fallbackMime || "application/octet-stream" });

  const formData = new FormData();
  formData.append("file", renamed, safeName);

  const res = await fetch("https://tmpfiles.org/api/v1/upload", { method: "POST", body: formData });
  if (!res.ok) throw new Error(`tmpfiles.org upload failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const pageUrl = data?.data?.url;
  if (!pageUrl) throw new Error("tmpfiles.org returned no URL. Response: " + JSON.stringify(data).slice(0, 200));
  return pageUrl.replace("tmpfiles.org/", "tmpfiles.org/dl/");
}

/**
 * Resolve any "image source" (data URL, http URL, File) to a public HTTPS URL
 * that the HappyHorse API can fetch. Required because all HappyHorse inputs
 * are URL-only (no base64).
 */
export async function resolveImageToPublicUrl(source) {
  if (!source) throw new Error("No image source provided.");
  if (typeof source === "string") {
    if (/^https?:\/\//i.test(source))   return source;
    if (source.startsWith("asset://"))  throw new Error("HappyHorse does not accept asset:// URIs — provide an HTTPS URL or upload a file.");
    if (source.startsWith("data:")) {
      // Convert base64 → File → tmpfiles upload
      const m = source.match(/^data:([^;]+);base64,(.*)$/);
      if (!m) throw new Error("Malformed data URL.");
      const mime = m[1];
      const ext  = mime.split("/")[1] || "png";
      const bin  = atob(m[2]);
      const arr  = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], `image.${ext}`, { type: mime });
      return uploadFileToTempHost(file, { fallbackName: `image.${ext}`, fallbackMime: mime });
    }
  }
  if (source instanceof File) {
    return uploadFileToTempHost(source, { fallbackName: "image.png", fallbackMime: "image/png" });
  }
  throw new Error("Unsupported image source for HappyHorse.");
}

/**
 * Save a video file locally via Node.js — privacy-respecting alternative to tmpfiles.
 * Returns the local path. The UI then asks the user to paste a public URL after manual hosting.
 */
export async function saveVideoLocally(file, targetDir) {
  if (typeof window === "undefined" || typeof window.require !== "function") {
    throw new Error("Local save requires Node.js (CEP). Not available in this environment.");
  }
  const _require = window.require;
  const fs   = _require("fs");
  const path = _require("path");

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const safeBase = (file.name || "reference.mp4").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  const stamp    = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath  = path.join(targetDir, `ref_${stamp}_${safeBase}`);

  const arrayBuf = await file.arrayBuffer();
  fs.writeFileSync(outPath, Buffer.from(arrayBuf));
  return outPath;
}

// ── fal.ai — controlnet preprocessor video generation ─────────────────────
// Shared queue runner for any fal endpoint that takes { video_url } and returns
// { video: { url } }. Used by depth and openpose preprocessors. Async queue
// is required because video inference exceeds the sync fal.run timeout. All
// requests use `Authorization: Key <KEY>` (NOT Bearer).
async function runFalVideoJob(slug, videoUrl, onProgress, label = "fal.ai") {
  const key = localStorage.getItem("seedance_fal_key") || "";
  if (!key) throw new Error("fal.ai API key not set — add it in Settings.");
  if (!videoUrl) throw new Error("No video URL provided.");
  if (!/^https?:\/\//i.test(videoUrl)) {
    throw new Error(`${label} requires a public HTTPS URL for the input video (got: ${videoUrl.slice(0, 40)}…).`);
  }

  const AUTH = { Authorization: `Key ${key}` };

  // 1) Submit to queue
  onProgress?.("submitting");
  const submitRes = await fetch(`https://queue.fal.run/${slug}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ...AUTH },
    body:    JSON.stringify({ video_url: videoUrl }),
  });
  if (!submitRes.ok) {
    const err = await submitRes.json().catch(() => ({}));
    throw new Error(err?.detail || err?.message || `${label} submit error ${submitRes.status}: ${submitRes.statusText}`);
  }
  const submitData = await submitRes.json();
  const statusUrl   = submitData.status_url;
  const responseUrl = submitData.response_url;
  if (!statusUrl || !responseUrl) {
    throw new Error(`${label} submit returned no status/response URL. Response: ` + JSON.stringify(submitData).slice(0, 300));
  }

  // 2) Poll until COMPLETED
  const started = Date.now();
  const TIMEOUT_MS = 10 * 60 * 1000;
  while (true) {
    await new Promise((r) => setTimeout(r, 3000));
    if (Date.now() - started > TIMEOUT_MS) {
      throw new Error(`${label} timed out after 10 minutes.`);
    }
    const pollRes = await fetch(statusUrl, { headers: AUTH });
    if (!pollRes.ok) {
      const err = await pollRes.json().catch(() => ({}));
      throw new Error(err?.detail || `${label} poll error ${pollRes.status}`);
    }
    const poll = await pollRes.json();
    const st = poll.status;
    onProgress?.(st || "polling");
    if (st === "COMPLETED") break;
    if (st === "FAILED" || st === "ERROR" || st === "CANCELLED") {
      throw new Error(`${label} job ${st}: ` + (poll.error || JSON.stringify(poll).slice(0, 200)));
    }
  }

  // 3) Fetch result
  const resultRes = await fetch(responseUrl, { headers: AUTH });
  if (!resultRes.ok) {
    throw new Error(`${label} result fetch ${resultRes.status}: ${resultRes.statusText}`);
  }
  const data = await resultRes.json();
  const url = data?.video?.url || data?.url;
  if (!url) {
    throw new Error(`${label} returned no output video URL. Response: ` + JSON.stringify(data).slice(0, 300));
  }
  onProgress?.("done");
  return url;
}

/** Depth map preprocessor (Depth Anything for video). */
export function generateDepthVideo(videoUrl, onProgress) {
  return runFalVideoJob("fal-ai/depth-anything-video", videoUrl, onProgress, "fal.ai depth");
}

/** OpenPose-style skeleton preprocessor (DWPose for video — replaces OpenPose,
 *  same downstream use as a ControlNet pose hint). */
export function generateOpenPoseVideo(videoUrl, onProgress) {
  return runFalVideoJob("fal-ai/dwpose/video", videoUrl, onProgress, "fal.ai pose");
}

// NOTE on Canny: fal.ai currently has no dedicated VIDEO canny endpoint
// (only image: fal-ai/image-preprocessors/canny). Per-frame extraction +
// reassembly is doable but slow/expensive — deferred until there's a real
// video canny endpoint or a local ffmpeg fallback.

// Audio: BytePlus accepts data:audio/...;base64 inline — zero network, zero privacy exposure.
export async function uploadAudioFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Seedream Image Generation & Edit ────────────────────────────────────────
// BytePlus ModelArk image endpoints. Same /images/generations endpoint takes
// either:
//   - prompt only        → text-to-image (generate from scratch)
//   - prompt + image[]   → image-to-image (edit an input)
// Different model IDs are best-suited to each mode.

const SEEDREAM_MODEL_T2I = "doubao-seedream-3-0-t2i-250415";  // text-to-image
const SEEDREAM_MODEL_I2I = "seedream-5-0-260128";             // image-edit (existing)
const SEEDREAM_MODEL = SEEDREAM_MODEL_I2I; // legacy alias used by editImage

// Seedream sizes that satisfy the ≥3,686,400 px min-area constraint (i2i).
// For t2i we keep the same list so matching the output to video aspects is
// consistent, and the sizes are within both models' accepted ranges.
export const SEEDREAM_T2I_SIZES = [
  { id: "1920x1920", label: "1:1 Square (1920)",     w: 1920, h: 1920 },
  { id: "2304x1728", label: "4:3 Landscape (2304)",  w: 2304, h: 1728 },
  { id: "1728x2304", label: "3:4 Portrait (1728)",   w: 1728, h: 2304 },
  { id: "2560x1440", label: "16:9 Wide (2560)",      w: 2560, h: 1440 },
  { id: "1440x2560", label: "9:16 Tall (1440)",      w: 1440, h: 2560 },
  { id: "2944x1280", label: "21:9 Ultrawide (2944)", w: 2944, h: 1280 },
  { id: "2816x2816", label: "1:1 Square (2816)",     w: 2816, h: 2816 },
];

/**
 * Generate an image from a text prompt (t2i).
 * Returns a base64 data URL of the result image.
 *
 * @param {string} prompt
 * @param {object} [opts] - { size?: "1024x1024", seed?: number, watermark?: bool }
 */
export async function generateImage(prompt, opts = {}) {
  const arkKey = getArkKey();
  if (!arkKey) throw new Error("ARK API key not set — open Settings to add your key.");
  if (!prompt || !prompt.trim()) throw new Error("No prompt provided.");

  const body = {
    model:           SEEDREAM_MODEL_T2I,
    prompt:          prompt.trim(),
    response_format: "b64_json",
    size:            opts.size || "1024x1024",
    watermark:       opts.watermark === true,
  };
  if (Number.isFinite(opts.seed) && opts.seed >= 0) body.seed = opts.seed;

  const res = await fetch(`${BYTEPLUS_BASE}/images/generations`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${arkKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err.error?.message || err.message || `Seedream t2i error ${res.status}: ${res.statusText}`
    );
  }
  const data = await res.json();
  const b64  = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image in Seedream t2i response: " + JSON.stringify(data).slice(0, 200));
  return `data:image/png;base64,${b64}`;
}

/**
 * Read the natural width/height of a base64 data URL.
 */
function getImageDimensions(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) return resolve(null);
    const img = new Image();
    img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Snap a desired (w, h) to a valid Seedream 5.0 size while preserving aspect.
 *
 * Seedream 5.0 (i2i) constraints observed in production:
 *   - Minimum output area: 3,686,400 pixels (≈ 1920² — the API error
 *     literally reads "image size must be at least 3686400 pixels").
 *   - Maximum output area: ~8,000,000 pixels (~2816² square upper bound).
 *   - Each side must be a multiple of 64.
 *
 * Strategy:
 *   1. Scale (w,h) up to hit MIN_AREA if the input is smaller.
 *   2. Scale down if we've exceeded MAX_AREA.
 *   3. Snap both dims to the nearest multiple of 64.
 *   4. Nudge up by 64 on whichever axis keeps us closest to MIN_AREA if
 *      snapping pushed us below (common for 16:9 inputs).
 */
function snapToSeedreamSize(w, h) {
  const MIN_AREA = 3_686_400;
  const MAX_AREA = 7_990_272; // ≈ 2816×2816
  const STEP = 64;

  const area0 = Math.max(1, w * h);
  if (area0 < MIN_AREA) {
    const k = Math.sqrt(MIN_AREA / area0);
    w *= k; h *= k;
  } else if (area0 > MAX_AREA) {
    const k = Math.sqrt(MAX_AREA / area0);
    w *= k; h *= k;
  }

  const snap = (v) => Math.max(STEP, Math.round(v / STEP) * STEP);
  let sw = snap(w), sh = snap(h);

  // If rounding down dropped us below the minimum area, bump one axis up.
  let guard = 0;
  while (sw * sh < MIN_AREA && guard++ < 64) {
    if (sw <= sh) sw += STEP; else sh += STEP;
  }
  // Safety clamp against ever going over the max by accident.
  guard = 0;
  while (sw * sh > MAX_AREA && guard++ < 64) {
    if (sw >= sh) sw -= STEP; else sh -= STEP;
  }
  return `${sw}x${sh}`;
}

/**
 * Edit an image using Seedream i2i.
 * Returns a base64 data URL of the result image.
 *
 * @param {string} imageDataUrl
 * @param {string} prompt
 * @param {object} [opts]
 *        - size: explicit "WxH" override (default: snap to input image's own dimensions)
 *        - matchInput: when true (default) and `size` is omitted, output matches input dims
 *        - seed: number
 *        - watermark: bool
 */
export async function editImage(imageDataUrl, prompt, opts = {}) {
  const arkKey = getArkKey();
  if (!arkKey) throw new Error("ARK API key not set — open Settings to add your key.");
  if (!imageDataUrl) throw new Error("No image provided.");

  // Decide output size:
  //   1. explicit opts.size wins
  //   2. matchInput (default) → snap input image's natural dimensions to a valid Seedream size
  //   3. fall back to 1024x1024
  let size = opts.size;
  if (!size && opts.matchInput !== false) {
    const dims = await getImageDimensions(imageDataUrl);
    if (dims && dims.w > 0 && dims.h > 0) {
      size = snapToSeedreamSize(dims.w, dims.h);
    }
  }
  if (!size) size = "1024x1024";

  const body = {
    model:           SEEDREAM_MODEL,
    prompt:          prompt.trim(),
    image:           [imageDataUrl],
    size,
    response_format: "b64_json",
    watermark:       opts.watermark === true,
  };
  if (Number.isFinite(opts.seed) && opts.seed >= 0) body.seed = opts.seed;

  const res = await fetch(`${BYTEPLUS_BASE}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${arkKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err.error?.message || err.message || `Seedream error ${res.status}: ${res.statusText}`
    );
  }

  const data = await res.json();
  const b64  = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image in Seedream response: " + JSON.stringify(data).slice(0, 200));
  return `data:image/png;base64,${b64}`;
}

// ── Z.AI Prompt Assistant ───────────────────────────────────────────────────

/**
 * Prompt assistant powered by Z.AI GLM — updated for Seedance 2.0.
 * Returns { prompt: "..." }
 */
export async function promptAssist(userRequest, mode = "t2v", images = {}) {
  const zaiKey = getZaiKey();
  if (!zaiKey) throw new Error("Z.AI API key not set — add it in Settings to use Prompt Assistant.");

  const MODE_HINTS = {
    t2v:
      "SCENARIO: Text-to-video. No reference assets attached. Generate a cinematic description with subject, action, camera movement, environment and mood.",
    i2v:
      "SCENARIO: Image-to-video (first frame). Image 1 (shown to you) is the STARTING frame, role=first_frame. Describe the motion and action that BEGINS from that state. DO NOT redescribe the image content; describe what HAPPENS next. Cite it as [Image 1].",
    i2v_fl:
      "SCENARIO: Image-to-video — first + last frame. Image 1 (shown to you) is the START state (role=first_frame); Image 2 is the END state (role=last_frame). Describe the visual transition, motion and transformation BETWEEN them. Use the formula: 'Starting from [Image 1], [motion and change], ending at [Image 2].'",
    ref:
      "SCENARIO: Multimodal reference generation (Seedance 2.0 omni-reference). All images below are reference_image, videos are reference_video, audios are reference_audio. You MUST cite each attached asset by [Image n] / [Video n] / [Audio n] using the slot numbers given in the ATTACHMENTS list below. Use the official Seedance 2.0 formulas.",
  };
  const modeHint = MODE_HINTS[mode] || "";

  // Resolve image sources
  const rawFirst = images?.firstFrameUploadId || images?.firstFrameUrl || null;
  const rawLast  = images?.lastFrameUploadId  || images?.lastFrameUrl  || null;
  const rawRefs  = (images?.refImages || []).filter(Boolean);

  const firstResolved = rawFirst ? await resizeImageForGLM(rawFirst) : null;
  const lastResolved  = rawLast  ? await resizeImageForGLM(rawLast)  : null;
  const refsResolved  = await Promise.all(rawRefs.map((r) => r ? resizeImageForGLM(r) : null));

  // Build an explicit ATTACHMENTS manifest so the vision assistant knows the
  // exact slot number to cite (critical for the [Image n] / [Video n] / [Audio n]
  // convention required by the Seedance API — see SEEDANCE_GUIDE).
  const rawRefVideos = (images?.refVideos || []).filter(Boolean);
  const rawRefAudios = (images?.refAudios || []).filter(Boolean);

  const attachmentLines = [];
  if (mode === "i2v" || mode === "i2v_fl") {
    if (firstResolved) attachmentLines.push("[Image 1]  ← first frame (role=first_frame, shown as image below)");
    if (lastResolved)  attachmentLines.push("[Image 2]  ← last frame  (role=last_frame, shown as image below)");
  } else if (mode === "ref") {
    refsResolved.forEach((r, i) => {
      if (r) attachmentLines.push(`[Image ${i + 1}]  ← reference_image (shown as image below)`);
    });
    rawRefVideos.forEach((_, i) => {
      attachmentLines.push(`[Video ${i + 1}]  ← reference_video (URL only — describe its intended use, do not re-see)`);
    });
    rawRefAudios.forEach((_, i) => {
      attachmentLines.push(`[Audio ${i + 1}]  ← reference_audio (URL only — describe intended use: voice timbre or background)`);
    });
  }

  const attachmentsManifest = attachmentLines.length > 0
    ? `\n\nATTACHMENTS (cite these exact slot numbers in the prompt):\n${attachmentLines.join("\n")}`
    : "";

  const useVision = !!(firstResolved || lastResolved || refsResolved.some(Boolean));

  let payload;

  if (useVision) {
    const userContent = [];

    if (firstResolved) {
      userContent.push({ type: "image_url", image_url: { url: firstResolved } });
    }
    if (lastResolved) {
      userContent.push({ type: "image_url", image_url: { url: lastResolved } });
    }
    refsResolved.forEach((r) => {
      if (r) userContent.push({ type: "image_url", image_url: { url: r } });
    });

    userContent.push({
      type: "text",
      text:
        `${SEEDANCE_GUIDE}\n\n${modeHint}${attachmentsManifest}\n\n` +
        `USER REQUEST (follow faithfully — preserve all concrete ideas):\n${userRequest}`,
    });

    payload = {
      model: ZAI_MODEL_VISION,
      messages: [{ role: "user", content: userContent }],
    };
  } else {
    payload = {
      model: ZAI_MODEL_TEXT,
      messages: [
        { role: "system", content: SEEDANCE_GUIDE },
        { role: "user",   content: `${modeHint}${attachmentsManifest}\n\n${userRequest}` },
      ],
      max_tokens: 1024,
      temperature: 0.7,
    };
  }

  const res = await fetch(ZAI_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${zaiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error?.message || `Z.AI error ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();

  let content = data.choices?.[0]?.message?.content ?? "";
  if (Array.isArray(content)) {
    content = content
      .map((part) => (typeof part === "string" ? part : part?.text ?? ""))
      .filter(Boolean)
      .join("\n");
  }

  return { prompt: String(content).trim() };
}

// ── Self-refinement (Karpathy autoresearch — actor-critic loop) ─────────────
// https://github.com/karpathy/autoresearch — the frozen layer is this runtime
// pipeline (deterministic); the mutable layer is SEEDANCE_GUIDE. Here we run a
// per-request mini-loop: generate → evaluate → rewrite. The evaluator is PURE
// deterministic code (regex checks against the official docs' hard rules); the
// rewriter is a small LLM call instructed to fix ONLY the flagged failures.

/**
 * Motion verbs the model and the docs actually use. Used by the evaluator to
 * reject "static description" outputs (Seedance dictum: "always make something
 * happen"). List kept broad — not all need to match, just one.
 */
const MOTION_VERBS = [
  "walks","walking","runs","running","moves","moving","turns","turning",
  "begins","starts","enters","exits","leaves","arrives","approaches",
  "opens","closes","sits","stands","lies","rises","falls","floats","flies","dances",
  "reaches","grabs","holds","picks","places","drops","throws","catches",
  "rotates","spins","shakes","trembles","explodes","shatters","breaks",
  "appears","disappears","fades","dissolves","transforms","morphs","emerges",
  "zooms","zoom","pans","pan","tilts","tilt","dollies","dolly","tracks","tracking",
  "orbits","orbit","pushes","pulls","cuts","transitions","transitioning",
  "speaks","says","whispers","shouts","sings","smiles","laughs","cries","looks",
  "reveals","sweeps","illuminates","glows","sprays","drips","drifts","flows",
  "leans","bows","spins","gallops","sprints","swings","stretches","reaches",
];

const META_PREFIX_PATTERNS = [
  /^here\s+(?:is|'s|are)\s/i,
  /^the\s+following\s/i,
  /^below\s+is\s/i,
  /^optimi[sz]ed\s+prompt\s*[:\-]/i,
  /^final\s+prompt\s*[:\-]/i,
  /^prompt\s*[:\-]/i,
];

/**
 * Deterministic evaluator. Returns an array of failure objects:
 *   { id: string, msg: string, severity: "hard" | "soft" }
 * Empty array = all constraints pass.
 *
 * Constraints derive from the official Seedance 2.0 tutorial (ModelArk PDFs).
 */
export function evaluatePrompt(prompt, ctx = {}) {
  const failures = [];
  const p = (prompt || "").trim();

  if (!p) {
    failures.push({ id: "empty", msg: "Prompt is empty.", severity: "hard" });
    return failures;
  }

  // (1) No meta / markdown wrappers (docs: "OUTPUT ONLY the final prompt text")
  if (META_PREFIX_PATTERNS.some((re) => re.test(p))) {
    failures.push({ id: "meta_prefix",
      msg: "Starts with a meta phrase (e.g. 'Here's the prompt:', 'Optimized prompt:'). Return the raw prompt text only — no preamble.",
      severity: "hard" });
  }
  if (/```/.test(p)) {
    failures.push({ id: "code_fence",
      msg: "Contains Markdown code fences. Return plain prompt text only.",
      severity: "hard" });
  }
  if (/^#+\s/m.test(p)) {
    failures.push({ id: "markdown_heading",
      msg: "Contains Markdown headings. Remove — return plain prompt text only.",
      severity: "hard" });
  }

  // (2) Not wrapped in outer quotes
  if (p.length > 20 && /^["'`]/.test(p) && /["'`]$/.test(p) &&
      p.replace(/["'`]/g, "").length > p.length - 4) {
    failures.push({ id: "wrap_quotes",
      msg: "The entire prompt is wrapped in quotes. Remove the outer quotes.",
      severity: "hard" });
  }

  // (3) Asset-ID / asset:// leak — docs: "NEVER cite an asset by its raw ID"
  if (/asset:\/\//i.test(p)) {
    failures.push({ id: "asset_uri_leak",
      msg: "Prompt contains 'asset://'. Seedance requires slot citation like [Image N] / [Video N] / [Audio N], not raw asset URIs.",
      severity: "hard" });
  }
  if (/\basset[-_]\d+/i.test(p) || /\b\d{15,}\b/.test(p)) {
    failures.push({ id: "raw_asset_id",
      msg: "Prompt contains a raw asset ID. Use the citation format [Image N] / [Video N] / [Audio N] with the slot number, never the underlying ID.",
      severity: "hard" });
  }

  // (4) Citation presence by mode — THE critical constraint.
  // Per the official BytePlus docs (tutorial PDF p.18): "Prompts must reference
  // assets in the format asset type + number. Referencing assets by Asset ID is
  // NOT supported." Without citation, attached refs are ignored by the model.
  const refImgCount = (ctx.refImages || []).length;
  const refVidCount = (ctx.refVideos || []).length;
  const refAudCount = (ctx.refAudios || []).length;
  const hasFirst = !!(ctx.firstFrameUploadId || ctx.firstFrameUrl);
  const hasLast  = !!(ctx.lastFrameUploadId  || ctx.lastFrameUrl);

  const imgCiteRe   = /\[?\s*image\s*\d+\s*\]?|\(\s*image\s*\d+\s*\)/i;
  const vidCiteRe   = /\[?\s*video\s*\d+\s*\]?|\(\s*video\s*\d+\s*\)/i;
  const audCiteRe   = /\[?\s*audio\s*\d+\s*\]?|\(\s*audio\s*\d+\s*\)/i;
  const cite = (n) => new RegExp(`\\[?\\s*image\\s*${n}\\s*\\]?|\\(\\s*image\\s*${n}\\s*\\)`, "i");

  if (ctx.mode === "ref") {
    if (refImgCount > 0 && !imgCiteRe.test(p)) {
      failures.push({ id: "missing_image_citation",
        msg: `${refImgCount} reference image(s) attached but the prompt doesn't cite any. Add [Image 1]${refImgCount > 1 ? `…[Image ${refImgCount}]` : ""} inline where each image is used.`,
        severity: "hard" });
    }
    if (refVidCount > 0 && !vidCiteRe.test(p)) {
      failures.push({ id: "missing_video_citation",
        msg: `${refVidCount} reference video(s) attached but the prompt doesn't cite any. Add [Video 1] inline.`,
        severity: "hard" });
    }
    if (refAudCount > 0 && !audCiteRe.test(p)) {
      failures.push({ id: "missing_audio_citation",
        msg: `${refAudCount} reference audio(s) attached but the prompt doesn't cite any. Add [Audio 1] inline.`,
        severity: "hard" });
    }
  } else if (ctx.mode === "i2v_fl") {
    if (hasFirst && !cite(1).test(p)) {
      failures.push({ id: "missing_first_frame_citation",
        msg: "First+Last Frame mode: the prompt must reference [Image 1] as the starting frame.",
        severity: "hard" });
    }
    if (hasLast && !cite(2).test(p)) {
      failures.push({ id: "missing_last_frame_citation",
        msg: "First+Last Frame mode: the prompt must reference [Image 2] as the ending frame.",
        severity: "hard" });
    }
  } else if (ctx.mode === "i2v") {
    if (hasFirst && !cite(1).test(p)) {
      failures.push({ id: "missing_first_frame_citation",
        msg: "Image-to-Video mode: the prompt should reference [Image 1] as the starting frame.",
        severity: "hard" });
    }
  }

  // (5) Motion presence — docs: "DO NOT describe static scenes without motion"
  const hasMotion = MOTION_VERBS.some((v) => new RegExp(`\\b${v}\\b`, "i").test(p));
  if (!hasMotion) {
    failures.push({ id: "no_motion",
      msg: "No explicit motion/camera verb found. Seedance needs motion — add at least one of: walks, turns, dollies, pans, tilts, reveals, zooms, transforms, etc.",
      severity: "hard" });
  }

  // (6) Word count limit per docs (<=1000 English words)
  const wordCount = p.split(/\s+/).filter(Boolean).length;
  if (wordCount > 1000) {
    failures.push({ id: "too_long",
      msg: `Prompt is ${wordCount} words — the docs recommend ≤ 1000. Trim to the essentials.`,
      severity: "hard" });
  }

  // (7) Naive English check — flag if 2+ common Italian function words appear.
  //     Kept conservative to avoid false positives on loanwords / names.
  const italianTriggers = ["che","sono","nella","quella","questa","degli","delle","molto","della","dello","perché","così","sempre","quando","senza","questo","questa","tutto","tutti","niente","qualcosa","dove","dopo","prima"];
  const italianCount = italianTriggers.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(p)).length;
  if (italianCount >= 2) {
    failures.push({ id: "not_english",
      msg: "Output appears to contain Italian. Translate the entire prompt to English (the docs specify English prompts; other languages are partially supported but English is most reliable).",
      severity: "hard" });
  }

  return failures;
}

/**
 * Rewriter pass. Given a candidate prompt + a list of failures, asks GLM-text
 * to fix ONLY those failures without changing anything else. Uses low temp
 * for conservative edits, and a targeted system prompt that instructs the
 * model to preserve correct content verbatim.
 */
async function rewritePrompt(candidate, failures, userRequest, mode, ctx) {
  const zaiKey = getZaiKey();
  if (!zaiKey) throw new Error("Z.AI API key not set.");

  const failureList = failures
    .map((f, i) => `${i + 1}. [${f.id}] ${f.msg}`)
    .join("\n");

  const attachSummary = [
    ctx.refImages?.length ? `${ctx.refImages.length} reference image(s) → cite as [Image 1]…[Image ${ctx.refImages.length}]` : null,
    ctx.refVideos?.length ? `${ctx.refVideos.length} reference video(s) → cite as [Video 1]…[Video ${ctx.refVideos.length}]` : null,
    ctx.refAudios?.length ? `${ctx.refAudios.length} reference audio(s) → cite as [Audio 1]…[Audio ${ctx.refAudios.length}]` : null,
    (ctx.firstFrameUploadId || ctx.firstFrameUrl) ? "[Image 1] is the first-frame image" : null,
    (ctx.lastFrameUploadId  || ctx.lastFrameUrl)  ? "[Image 2] is the last-frame image"  : null,
  ].filter(Boolean).join("\n");

  const system =
`You are a constrained prompt rewriter for Seedance 2.0 video generation. You receive:
  - the user's original intent,
  - a candidate prompt produced upstream,
  - a list of specific constraint failures.

Your only job is to fix the failures while preserving everything that is already correct.
Do not rewrite the whole prompt. Do not add new characters, objects, or actions the user did not request. Do not translate away or embellish content that already satisfies the rules.
Output ONLY the corrected prompt text — no explanations, no prefixes, no markdown, no surrounding quotes.`;

  const user =
`ORIGINAL USER REQUEST:
${userRequest}

ATTACHED REFERENCES (authoritative — cite these slots verbatim in the prompt):
${attachSummary || "(none)"}

CANDIDATE PROMPT (fix only the listed failures):
${candidate}

CONSTRAINT FAILURES TO FIX:
${failureList}

Return the corrected prompt text now.`;

  const payload = {
    model: ZAI_MODEL_TEXT,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user },
    ],
    max_tokens: 1500,
    temperature: 0.3,
  };

  const res = await fetch(ZAI_BASE_URL, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${zaiKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error?.message || `Rewriter error ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  let content = data.choices?.[0]?.message?.content ?? "";
  if (Array.isArray(content)) {
    content = content
      .map((part) => (typeof part === "string" ? part : part?.text ?? ""))
      .filter(Boolean).join("\n");
  }
  return String(content).trim();
}

/**
 * Refined prompt flow (Karpathy autoresearch-style critic-actor loop).
 *
 *   Actor    → promptAssist() generates a candidate.
 *   Critic   → evaluatePrompt() runs deterministic constraint checks.
 *   Rewriter → rewritePrompt() fixes only the failing constraints.
 *
 * Iterates up to `maxIter` rewrite passes. Returns { prompt, history, passed }
 * so the UI can show what was checked, what failed, and what got fixed.
 *
 * @param {string} userRequest
 * @param {string} mode
 * @param {object} images  — same shape as promptAssist() accepts
 * @param {object} [opts]  — { maxIter: 2, onProgress: (stage) => void }
 */
export async function promptAssistRefined(userRequest, mode = "t2v", images = {}, opts = {}) {
  const maxIter = Number.isFinite(opts.maxIter) ? opts.maxIter : 2;
  const onProgress = opts.onProgress || (() => {});

  const ctx = {
    mode,
    refImages: (images?.refImages || []).filter(Boolean),
    refVideos: (images?.refVideos || []).filter(Boolean),
    refAudios: (images?.refAudios || []).filter(Boolean),
    firstFrameUploadId: images?.firstFrameUploadId,
    firstFrameUrl:      images?.firstFrameUrl,
    lastFrameUploadId:  images?.lastFrameUploadId,
    lastFrameUrl:       images?.lastFrameUrl,
  };

  const history = [];

  // Actor: initial generation
  onProgress({ stage: "generate", iteration: 0 });
  const first = await promptAssist(userRequest, mode, images);
  let candidate = first.prompt;

  let failures = evaluatePrompt(candidate, ctx);
  history.push({ iteration: 0, prompt: candidate, failures });

  let iter = 0;
  while (iter < maxIter && failures.length > 0) {
    iter++;
    onProgress({ stage: "rewrite", iteration: iter, failures });
    try {
      const rewritten = await rewritePrompt(candidate, failures, userRequest, mode, ctx);
      if (rewritten && rewritten.length > 0) candidate = rewritten;
    } catch (e) {
      // Rewrite failed — keep the previous candidate, record the error, break.
      history.push({ iteration: iter, prompt: candidate, failures, error: e.message });
      break;
    }
    failures = evaluatePrompt(candidate, ctx);
    history.push({ iteration: iter, prompt: candidate, failures });
  }

  onProgress({ stage: "done", iteration: iter, failures });
  return {
    prompt: candidate,
    history,
    passed: failures.length === 0,
    iterations: iter,
  };
}

// ── Seedance 1.5 Pro prompt assist (different model + different rules) ──────
//
// 1.5 Pro has NO omni-references and NO slot citation system. The evaluator
// must therefore enforce the OPPOSITE of what 2.0 enforces for citations:
// citing "[Image n]" / "[Video n]" / "[Audio n]" in a 1.5 Pro prompt is a bug.

/**
 * Deterministic evaluator for Seedance 1.5 Pro prompts. Mirrors the structure
 * of evaluatePrompt() but with 1.5-specific constraints derived from the
 * official prompt guide (Subject + Movement formula, no slot citations,
 * native audio handled in prose, ≤1000 words).
 */
export function evaluatePrompt15(prompt, ctx = {}) {
  const failures = [];
  const p = (prompt || "").trim();

  if (!p) {
    failures.push({ id: "empty", msg: "Prompt is empty.", severity: "hard" });
    return failures;
  }

  // (1) No meta / markdown wrappers
  if (META_PREFIX_PATTERNS.some((re) => re.test(p))) {
    failures.push({ id: "meta_prefix",
      msg: "Starts with a meta phrase (e.g. 'Here's the prompt:', 'Optimized prompt:'). Return the raw prompt text only.",
      severity: "hard" });
  }
  if (/```/.test(p)) {
    failures.push({ id: "code_fence",
      msg: "Contains Markdown code fences. Return plain prompt text only.",
      severity: "hard" });
  }
  if (/^#+\s/m.test(p)) {
    failures.push({ id: "markdown_heading",
      msg: "Contains Markdown headings. Remove them.",
      severity: "hard" });
  }

  // (2) Outer quote wrap
  if (p.length > 20 && /^["'`]/.test(p) && /["'`]$/.test(p) &&
      p.replace(/["'`]/g, "").length > p.length - 4) {
    failures.push({ id: "wrap_quotes",
      msg: "The entire prompt is wrapped in quotes. Remove the outer quotes.",
      severity: "hard" });
  }

  // (3) Slot citation LEAK — 1.5 Pro has no slot system; citing [Image n] /
  //     [Video n] / [Audio n] is invalid here (it's a 2.0-only convention).
  if (/\[?\s*image\s*\d+\s*\]?|\[?\s*video\s*\d+\s*\]?|\[?\s*audio\s*\d+\s*\]?/i.test(p)) {
    failures.push({ id: "slot_citation_leak",
      msg: "Prompt contains [Image n] / [Video n] / [Audio n] slot citations. Seedance 1.5 Pro doesn't have a slot system — describe the content directly in prose instead (e.g. 'the lipstick' or 'the woman in the photo').",
      severity: "hard" });
  }

  // (4) Asset URI leak — same rule as 2.0
  if (/asset:\/\//i.test(p)) {
    failures.push({ id: "asset_uri_leak",
      msg: "Prompt contains 'asset://'. Seedance 1.5 Pro doesn't accept asset:// references — use prose to describe.",
      severity: "hard" });
  }

  // (5) Motion presence — same as 2.0
  const hasMotion = MOTION_VERBS.some((v) => new RegExp(`\\b${v}\\b`, "i").test(p));
  if (!hasMotion) {
    failures.push({ id: "no_motion",
      msg: "No explicit motion/camera verb found. Seedance needs motion — add one of: walks, turns, dollies, pans, tilts, reveals, etc.",
      severity: "hard" });
  }

  // (6) Word count limit (≤1000 per docs)
  const wordCount = p.split(/\s+/).filter(Boolean).length;
  if (wordCount > 1000) {
    failures.push({ id: "too_long",
      msg: `Prompt is ${wordCount} words — the docs recommend ≤ 1000.`,
      severity: "hard" });
  }

  // (7) English-only heuristic (1.5 Pro DOES support Chinese natively, but
  //     since our UI is English-targeted by default we still flag obvious
  //     non-English output. We're more permissive than 2.0: only flag if
  //     ≥3 Italian function words appear, since 1.5 Pro accepts CN/EN.)
  const italianTriggers = ["che","sono","nella","quella","questa","degli","delle","molto","della","dello","perché","così","sempre","quando","senza","questo","questa","tutto","tutti","niente","qualcosa","dove","dopo","prima"];
  const italianCount = italianTriggers.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(p)).length;
  if (italianCount >= 3) {
    failures.push({ id: "not_english",
      msg: "Output appears to contain Italian. Translate to English (or Chinese if the user explicitly requested a CN dialect — 1.5 Pro supports Mandarin/Cantonese/Sichuan/Shaanxi).",
      severity: "hard" });
  }

  // (8) Mode-specific: in i2v mode, the user has uploaded a starting frame,
  //     but 1.5 Pro doesn't use slot citation. Just check that motion description
  //     exists (already done above) — no extra constraint here.

  return failures;
}

/**
 * Single-pass prompt generator for Seedance 1.5 Pro.
 * Same shape as promptAssist() but uses SEEDANCE_15_GUIDE.
 */
export async function promptAssist15(userRequest, mode = "t2v", images = {}) {
  const zaiKey = getZaiKey();
  if (!zaiKey) throw new Error("Z.AI API key not set — add it in Settings to use Prompt Assistant.");

  const MODE_HINTS = {
    t2v: "SCENARIO: Text-to-video. Pure prose description; no attached references. Use the formula Subject + Movement + Environment + Camera + Aesthetic + Sound.",
    i2v: "SCENARIO: Image-to-video (first frame). The user has attached a starting-frame image (shown to you below). Describe the motion and action that BEGINS from that visual state. DO NOT cite '[Image 1]' — 1.5 Pro has no slot system. Just describe the content directly (e.g. 'the woman in the photo lifts her arm…').",
    flf: "SCENARIO: Image-to-video — first + last frame. The user has attached a START image (first frame, shown to you) and an END image (last frame, shown to you). Describe the visual transition / motion / transformation BETWEEN those two states. DO NOT cite '[Image 1]'/'[Image 2]' — describe the scene transition in prose.",
  };
  const modeHint = MODE_HINTS[mode] || MODE_HINTS.t2v;

  // Resolve images for vision (1.5 Pro accepts only first/last frame, never refs)
  const rawFirst = images?.firstFrameUploadId || images?.firstFrameUrl || null;
  const rawLast  = images?.lastFrameUploadId  || images?.lastFrameUrl  || null;
  const firstResolved = rawFirst ? await resizeImageForGLM(rawFirst) : null;
  const lastResolved  = rawLast  ? await resizeImageForGLM(rawLast)  : null;
  const useVision = !!(firstResolved || lastResolved);

  let payload;
  if (useVision) {
    const userContent = [];
    if (firstResolved) userContent.push({ type: "image_url", image_url: { url: firstResolved } });
    if (lastResolved)  userContent.push({ type: "image_url", image_url: { url: lastResolved } });
    userContent.push({
      type: "text",
      text: `${SEEDANCE_15_GUIDE}\n\n${modeHint}\n\nUSER REQUEST (follow faithfully):\n${userRequest}`,
    });
    payload = {
      model: ZAI_MODEL_VISION,
      messages: [{ role: "user", content: userContent }],
    };
  } else {
    payload = {
      model: ZAI_MODEL_TEXT,
      messages: [
        { role: "system", content: SEEDANCE_15_GUIDE },
        { role: "user",   content: `${modeHint}\n\n${userRequest}` },
      ],
      max_tokens: 1024,
      temperature: 0.7,
    };
  }

  const res = await fetch(ZAI_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${zaiKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error?.message || `Z.AI error ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  let content = data.choices?.[0]?.message?.content ?? "";
  if (Array.isArray(content)) {
    content = content.map((p) => (typeof p === "string" ? p : p?.text ?? "")).filter(Boolean).join("\n");
  }
  return { prompt: String(content).trim() };
}

/** Rewriter pass for 1.5 Pro — fixes only flagged failures with the 1.5 guide context. */
async function rewritePrompt15(candidate, failures, userRequest, mode) {
  const zaiKey = getZaiKey();
  if (!zaiKey) throw new Error("Z.AI API key not set.");

  const failureList = failures.map((f, i) => `${i + 1}. [${f.id}] ${f.msg}`).join("\n");

  const system =
`You are a constrained prompt rewriter for Seedance 1.5 Pro video generation.
This model does NOT have a slot-reference system: never cite "[Image n]" /
"[Video n]" / "[Audio n]" — describe content directly in prose.

You receive the user's intent, a candidate prompt, and a list of constraint
failures. Fix ONLY the listed failures while preserving everything correct.
Do not add new characters / objects / actions the user did not request.
Output ONLY the corrected prompt text — no explanations, no prefixes, no
markdown, no surrounding quotes.`;

  const user =
`ORIGINAL USER REQUEST:
${userRequest}

SCENARIO: ${mode === "flf" ? "Image-to-video first+last frame" : mode === "i2v" ? "Image-to-video first frame" : "Text-to-video"}

CANDIDATE PROMPT (fix only the listed failures):
${candidate}

CONSTRAINT FAILURES TO FIX:
${failureList}

Return the corrected prompt text now.`;

  const payload = {
    model: ZAI_MODEL_TEXT,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user },
    ],
    max_tokens: 1500,
    temperature: 0.3,
  };

  const res = await fetch(ZAI_BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${zaiKey}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error?.message || `Rewriter error ${res.status}`);
  }
  const data = await res.json();
  let content = data.choices?.[0]?.message?.content ?? "";
  if (Array.isArray(content)) {
    content = content.map((p) => (typeof p === "string" ? p : p?.text ?? "")).filter(Boolean).join("\n");
  }
  return String(content).trim();
}

/**
 * Refined prompt flow for Seedance 1.5 Pro. Same actor-critic pattern as
 * promptAssistRefined(), specialized to the 1.5 evaluator + rewriter.
 */
export async function promptAssistRefined15(userRequest, mode = "t2v", images = {}, opts = {}) {
  const maxIter = Number.isFinite(opts.maxIter) ? opts.maxIter : 2;
  const onProgress = opts.onProgress || (() => {});

  const ctx = {
    mode,
    firstFrameUploadId: images?.firstFrameUploadId,
    firstFrameUrl:      images?.firstFrameUrl,
    lastFrameUploadId:  images?.lastFrameUploadId,
    lastFrameUrl:       images?.lastFrameUrl,
  };

  const history = [];

  onProgress({ stage: "generate", iteration: 0 });
  const first = await promptAssist15(userRequest, mode, images);
  let candidate = first.prompt;

  let failures = evaluatePrompt15(candidate, ctx);
  history.push({ iteration: 0, prompt: candidate, failures });

  let iter = 0;
  while (iter < maxIter && failures.length > 0) {
    iter++;
    onProgress({ stage: "rewrite", iteration: iter, failures });
    try {
      const rewritten = await rewritePrompt15(candidate, failures, userRequest, mode);
      if (rewritten && rewritten.length > 0) candidate = rewritten;
    } catch (e) {
      history.push({ iteration: iter, prompt: candidate, failures, error: e.message });
      break;
    }
    failures = evaluatePrompt15(candidate, ctx);
    history.push({ iteration: iter, prompt: candidate, failures });
  }

  onProgress({ stage: "done", iteration: iter, failures });
  return {
    prompt: candidate,
    history,
    passed: failures.length === 0,
    iterations: iter,
  };
}


// ════════════════════════════════════════════════════════════════════════════
// HappyHorse — Alibaba Cloud Model Studio (DashScope) async video models
// ════════════════════════════════════════════════════════════════════════════

export const HAPPYHORSE_REGIONS = {
  singapore:    "https://dashscope-intl.aliyuncs.com",
  beijing:      "https://dashscope.aliyuncs.com",
  "us-virginia":"https://dashscope-us.aliyuncs.com",
  hk:           "https://cn-hongkong.dashscope.aliyuncs.com",
};

export const HAPPYHORSE_MODELS = {
  t2v:    "happyhorse-1.0-t2v",
  i2v:    "happyhorse-1.0-i2v",
  r2v:    "happyhorse-1.0-r2v",
  edit:   "happyhorse-1.0-video-edit",
};

export const HAPPYHORSE_RESOLUTIONS = ["720P", "1080P"];
export const HAPPYHORSE_RATIOS      = ["16:9", "9:16", "1:1", "4:3", "3:4"];

function getAlibabaKey() {
  return localStorage.getItem("seedance_alibaba_key") || "";
}
function getHappyHorseBaseUrl() {
  const region = localStorage.getItem("seedance_hh_region") || "singapore";
  return HAPPYHORSE_REGIONS[region] || HAPPYHORSE_REGIONS.singapore;
}

export async function createHappyHorseTask(payload) {
  const key = getAlibabaKey();
  if (!key) throw new Error("Alibaba Cloud API key not set — open Settings to add it.");
  const base = getHappyHorseBaseUrl();
  const res = await fetch(`${base}/api/v1/services/aigc/video-generation/video-synthesis`, {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "Authorization":     `Bearer ${key}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.code) {
    throw new Error(
      data.message ||
      `HappyHorse create-task failed: ${res.status} ${res.statusText}` +
      (data.code ? ` (${data.code})` : "")
    );
  }
  const taskId = data?.output?.task_id;
  if (!taskId) throw new Error("HappyHorse returned no task_id. Response: " + JSON.stringify(data).slice(0, 300));
  return { task_id: taskId, request_id: data.request_id, status: data?.output?.task_status || "PENDING" };
}

export async function pollHappyHorseTask(taskId) {
  const key = getAlibabaKey();
  if (!key) throw new Error("Alibaba Cloud API key not set.");
  const base = getHappyHorseBaseUrl();
  const res = await fetch(`${base}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
    headers: { "Authorization": `Bearer ${key}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Poll failed: ${res.status} ${res.statusText}`);
  return data?.output || {};
}

export async function runHappyHorse(payload, opts = {}) {
  const onProgress   = opts.onProgress   || (() => {});
  const pollInterval = opts.pollInterval || 15000;
  const maxWaitMs    = opts.maxWaitMs    || 10 * 60 * 1000;

  onProgress({ stage: "submitting" });
  const { task_id } = await createHappyHorseTask(payload);
  onProgress({ stage: "queued", task_id });

  const started = Date.now();
  let lastStatus = "PENDING";
  while (Date.now() - started < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollInterval));
    let output;
    try { output = await pollHappyHorseTask(task_id); }
    catch (e) {
      onProgress({ stage: "poll_error", error: e.message });
      continue;
    }
    const status = output.task_status || "UNKNOWN";
    if (status !== lastStatus) {
      lastStatus = status;
      onProgress({ stage: status.toLowerCase(), task_id, output });
    }
    if (status === "SUCCEEDED") {
      return {
        task_id,
        video_url: output.video_url,
        orig_prompt: output.orig_prompt,
        usage: output.usage,
        end_time: output.end_time,
      };
    }
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      throw new Error(
        `HappyHorse task ${status}: ` +
        (output.message || output.code || "no details from API")
      );
    }
  }
  throw new Error(`HappyHorse task did not complete within ${Math.round(maxWaitMs / 60000)} minutes.`);
}

// ── HappyHorse prompt guide (verbatim/derived from the four official docs) ──
const HAPPYHORSE_GUIDE = `You are a prompt engineer for HappyHorse 1.0
(Alibaba Cloud Model Studio / DashScope). HappyHorse 1.0 has FOUR distinct
models, each with different inputs and citation rules — the rules below come
from the four official model docs. Follow them exactly. Do not invent syntax.

═══════════════════════════════════════════════════════════════════════════════
1. THE FOUR MODELS — KNOW WHICH ONE YOU'RE WRITING FOR
═══════════════════════════════════════════════════════════════════════════════

  • happyhorse-1.0-t2v        — Text-to-video. Pure text prompt.
  • happyhorse-1.0-i2v        — Image-to-video (first frame). Prose + 1 image
                                 (passed via media[type=first_frame]). Output
                                 aspect ratio AUTO-FOLLOWS the input image —
                                 DO NOT mention a specific aspect ratio.
  • happyhorse-1.0-r2v        — Reference-to-video. Prose with [Image 1]…
                                 [Image N] citations and 1-9 reference images.
                                 You MUST cite each image you want the model
                                 to use as [Image n] (square brackets, capital
                                 I), and you MUST identify the subject from
                                 that image. Docs example: "the woman in red
                                 qipao in [Image 1]".
  • happyhorse-1.0-video-edit — Video editing. Describe the EDIT to apply to
                                 the input video (style transfer, local
                                 replacement). Optional 0-5 reference images
                                 provide replacement content. NO slot
                                 citations — describe in prose. Docs example:
                                 "Make the horse-headed humanoid character in
                                 the video wear the striped sweater from the
                                 image".

═══════════════════════════════════════════════════════════════════════════════
2. PROMPT LANGUAGE & LENGTH
═══════════════════════════════════════════════════════════════════════════════

  - Any language supported. English and Chinese most reliable.
  - Hard limit per docs: 5,000 non-Chinese chars OR 2,500 Chinese chars.
  - Aim for 60-300 words for cinematic prompts.

═══════════════════════════════════════════════════════════════════════════════
3. CITATION RULES (CRITICAL FOR r2v)
═══════════════════════════════════════════════════════════════════════════════

In r2v mode the prompt MUST cite each reference image:

  [Image 1] = first reference image in media[]
  [Image 2] = second reference image
  ...
  [Image N] = nth reference image

Always pair the citation with a description of the subject.

  CORRECT   → "The woman in the red qipao from [Image 1] turns and unfolds
              the folding fan from [Image 2], while the tassel earrings from
              [Image 3] sway delicately."
  INCORRECT → "[Image 1] [Image 2] [Image 3] beautiful scene"  (no subject)
  INCORRECT → "image1, image2, image3"                          (wrong format)

t2v, i2v, and video-edit do NOT use [Image n] — describe content in prose.

═══════════════════════════════════════════════════════════════════════════════
4. VERBATIM OFFICIAL EXAMPLES
═══════════════════════════════════════════════════════════════════════════════

--- t2v example ---
"A miniature city built from cardboard and bottle caps comes to life at
night. A cardboard train slowly passes through, with small lights dotting
the scene and illuminating the way ahead."

--- i2v example ---
"A cat running on the grass"
[The first frame is supplied separately as media; do not redescribe it.]

--- r2v example (cinematic, multi-image) ---
"The woman in the red qipao from [Image 1] is first framed in a profile
medium shot, highlighting the tailored cut and S-curve silhouette of the
dress. The camera then cuts to a low-angle upward shot, capturing the moment
she gracefully raises her hand to unfold the folding fan from [Image 2],
while the tassel earrings from [Image 3] sway delicately with the turn of
her head. Finally, the lens pushes in for a facial close-up, freezing the
subtle, alluring charm in her shifting gaze as her fingertips lightly rest
on the ribs of the fan."

--- video-edit example ---
"Make the horse-headed humanoid character in the video wear the striped
sweater from the image"

═══════════════════════════════════════════════════════════════════════════════
5. CRAFT TIPS DERIVED FROM THE DOCS
═══════════════════════════════════════════════════════════════════════════════

  - Lead with subject + primary action. Add camera framing and motion next.
  - For multi-shot sequences, chain shot descriptions in temporal order
    ("first framed in… The camera then cuts to… Finally, the lens pushes in…").
  - Prefer specific motion verbs: walks, runs, raises, gracefully unfolds,
    push in, dolly out, cuts to, freezes on.
  - In video-edit, be explicit about the BEFORE state and the AFTER state.

═══════════════════════════════════════════════════════════════════════════════
6. ABSOLUTE RULES
═══════════════════════════════════════════════════════════════════════════════

  - OUTPUT ONLY the final prompt text — no labels, no explanations, no
    markdown, no surrounding quotes.
  - Preserve ALL the user's concrete intentions; improve only the WORDING.
  - DO NOT invent characters/objects/actions the user did not request.
  - DO NOT describe static scenes — always include motion or change.
  - For r2v: every [Image N] you cite must correspond to a slot the user
    actually attached, paired with a subject description.
  - For i2v: do not specify aspect ratio (output follows input image).
  - For video-edit: focus on the edit instruction.`;

export function evaluatePromptHH(prompt, ctx = {}) {
  const failures = [];
  const p = (prompt || "").trim();
  if (!p) return [{ id: "empty", msg: "Prompt is empty.", severity: "hard" }];

  if (META_PREFIX_PATTERNS.some((re) => re.test(p))) {
    failures.push({ id: "meta_prefix",
      msg: "Starts with a meta phrase. Return only the raw prompt text.",
      severity: "hard" });
  }
  if (/```/.test(p)) {
    failures.push({ id: "code_fence",
      msg: "Contains code fences. Return plain prompt text only.",
      severity: "hard" });
  }
  if (p.length > 20 && /^["'`]/.test(p) && /["'`]$/.test(p) &&
      p.replace(/["'`]/g, "").length > p.length - 4) {
    failures.push({ id: "wrap_quotes",
      msg: "Entire prompt is wrapped in outer quotes — remove them.",
      severity: "hard" });
  }
  if (p.length > 5000) {
    failures.push({ id: "too_long",
      msg: `Prompt is ${p.length} chars — docs cap at 5,000 (2,500 if Chinese). Trim.`,
      severity: "hard" });
  }

  const refImgCount = (ctx.refImages || []).length;
  const imgCiteRe = /\[\s*image\s*\d+\s*\]/i;

  if (ctx.model === "r2v") {
    if (refImgCount > 0 && !imgCiteRe.test(p)) {
      failures.push({ id: "missing_image_citation",
        msg: `${refImgCount} reference image(s) attached but the prompt doesn't cite any. Add [Image 1]${refImgCount > 1 ? `…[Image ${refImgCount}]` : ""} where each is used.`,
        severity: "hard" });
    }
  } else if (imgCiteRe.test(p)) {
    failures.push({ id: "wrong_citation",
      msg: `[Image n] citations are only for r2v mode. In ${ctx.model} mode, describe content in prose instead.`,
      severity: "hard" });
  }

  const hasMotion = MOTION_VERBS.some((v) => new RegExp(`\\b${v}\\b`, "i").test(p));
  if (!hasMotion) {
    failures.push({ id: "no_motion",
      msg: "No explicit motion/camera verb found. Add at least one (walks, turns, dollies, pans, cuts, reveals, etc).",
      severity: "hard" });
  }

  if (ctx.model === "i2v" && /\b(?:16:9|9:16|4:3|3:4|1:1|aspect ratio)\b/i.test(p)) {
    failures.push({ id: "aspect_in_i2v",
      msg: "i2v output aspect auto-follows the input image. Don't specify aspect ratio in the prompt.",
      severity: "hard" });
  }

  return failures;
}

export async function promptAssistHH(userRequest, model = "t2v", images = {}) {
  const zaiKey = getZaiKey();
  if (!zaiKey) throw new Error("Z.AI API key not set — add it in Settings to use Prompt Assistant.");

  const MODE_HINTS = {
    t2v:  "SCENARIO: HappyHorse text-to-video (happyhorse-1.0-t2v). No attached references — pure prose. Cite no [Image n].",
    i2v:  "SCENARIO: HappyHorse image-to-video first-frame (happyhorse-1.0-i2v). The first-frame image is shown to you below. Describe the motion / action that BEGINS from that visual state. DO NOT cite [Image 1]. DO NOT mention aspect ratio.",
    r2v:  "SCENARIO: HappyHorse reference-to-video (happyhorse-1.0-r2v). The reference images are shown to you below in slot order. You MUST cite each as [Image 1]…[Image N] paired with a subject description.",
    edit: "SCENARIO: HappyHorse video-edit (happyhorse-1.0-video-edit). The user supplies a video to edit and 0-5 reference images. Describe the EDIT precisely. NO [Image n] citations — describe in prose. Be explicit about BEFORE state and AFTER state.",
  };
  const modeHint = MODE_HINTS[model] || MODE_HINTS.t2v;

  const refImgs    = (images?.refImages || []).filter(Boolean);
  const firstFrame = images?.firstFrame || null;
  const editVideo  = images?.editVideo  || null;

  const refResolved   = await Promise.all(refImgs.map((r) => r ? resizeImageForGLM(r) : null));
  const firstResolved = firstFrame ? await resizeImageForGLM(firstFrame) : null;
  const useVision = !!(firstResolved || refResolved.some(Boolean));

  const attachLines = [];
  if (model === "i2v" && firstResolved)
    attachLines.push("first-frame image  ← shown below (do not cite as [Image n])");
  if (model === "r2v") {
    refResolved.forEach((r, i) => {
      if (r) attachLines.push(`[Image ${i + 1}]  ← reference image (shown below — must cite in prompt)`);
    });
  }
  if (model === "edit") {
    if (editVideo) attachLines.push("input video to edit (URL only, not shown as vision)");
    refResolved.forEach((r, i) => {
      if (r) attachLines.push(`reference image ${i + 1}  ← shown below (describe in prose, no slot citation)`);
    });
  }
  const manifest = attachLines.length ? `\n\nATTACHMENTS:\n${attachLines.join("\n")}` : "";

  let payload;
  if (useVision) {
    const userContent = [];
    if (firstResolved) userContent.push({ type: "image_url", image_url: { url: firstResolved } });
    refResolved.forEach((r) => { if (r) userContent.push({ type: "image_url", image_url: { url: r } }); });
    userContent.push({
      type: "text",
      text: `${HAPPYHORSE_GUIDE}\n\n${modeHint}${manifest}\n\nUSER REQUEST (follow faithfully):\n${userRequest}`,
    });
    payload = { model: ZAI_MODEL_VISION, messages: [{ role: "user", content: userContent }] };
  } else {
    payload = {
      model: ZAI_MODEL_TEXT,
      messages: [
        { role: "system", content: HAPPYHORSE_GUIDE },
        { role: "user",   content: `${modeHint}${manifest}\n\n${userRequest}` },
      ],
      max_tokens: 1024,
      temperature: 0.7,
    };
  }

  const res = await fetch(ZAI_BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${zaiKey}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error?.message || `Z.AI error ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  let content = data.choices?.[0]?.message?.content ?? "";
  if (Array.isArray(content)) {
    content = content.map((p) => (typeof p === "string" ? p : p?.text ?? "")).filter(Boolean).join("\n");
  }
  return { prompt: String(content).trim() };
}

async function rewritePromptHH(candidate, failures, userRequest, model, ctx) {
  const zaiKey = getZaiKey();
  if (!zaiKey) throw new Error("Z.AI API key not set.");
  const failureList = failures.map((f, i) => `${i + 1}. [${f.id}] ${f.msg}`).join("\n");
  const refsAttached = (ctx.refImages?.length || 0);
  const attachSummary = model === "r2v" && refsAttached
    ? `${refsAttached} reference image(s) — cite as [Image 1]…[Image ${refsAttached}] with subjects.`
    : model === "i2v" ? "First-frame image attached — do NOT cite, do NOT mention aspect ratio."
    : model === "edit" ? "Input video + optional reference image(s) — describe the edit in prose, no slot citations."
    : "Pure text-to-video — no attached references.";

  const system =
`You are a constrained prompt rewriter for HappyHorse 1.0 (${ctx.model || model}).
Fix ONLY the listed constraint failures. Preserve everything correct.
Do not invent new content. Output ONLY the corrected prompt — no preamble.

Citation rules:
  - r2v MUST cite [Image 1]…[Image N] paired with a subject phrase.
  - t2v / i2v / video-edit MUST NOT use [Image n] citations.
  - i2v MUST NOT mention aspect ratio.`;

  const user =
`USER REQUEST:
${userRequest}

ATTACHMENTS:
${attachSummary}

CANDIDATE PROMPT:
${candidate}

FAILURES TO FIX:
${failureList}

Return the corrected prompt now.`;

  const payload = {
    model: ZAI_MODEL_TEXT,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user },
    ],
    max_tokens: 1500,
    temperature: 0.3,
  };
  const res = await fetch(ZAI_BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${zaiKey}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error?.message || `Rewriter error ${res.status}`);
  }
  const data = await res.json();
  let content = data.choices?.[0]?.message?.content ?? "";
  if (Array.isArray(content)) {
    content = content.map((p) => (typeof p === "string" ? p : p?.text ?? "")).filter(Boolean).join("\n");
  }
  return String(content).trim();
}

export async function promptAssistRefinedHH(userRequest, model = "t2v", images = {}, opts = {}) {
  const maxIter = Number.isFinite(opts.maxIter) ? opts.maxIter : 2;
  const onProgress = opts.onProgress || (() => {});

  const ctx = { model, refImages: (images?.refImages || []).filter(Boolean) };
  const history = [];

  onProgress({ stage: "generate", iteration: 0 });
  const first = await promptAssistHH(userRequest, model, images);
  let candidate = first.prompt;
  let failures = evaluatePromptHH(candidate, ctx);
  history.push({ iteration: 0, prompt: candidate, failures });

  let iter = 0;
  while (iter < maxIter && failures.length > 0) {
    iter++;
    onProgress({ stage: "rewrite", iteration: iter, failures });
    try {
      const rewritten = await rewritePromptHH(candidate, failures, userRequest, model, ctx);
      if (rewritten && rewritten.length > 0) candidate = rewritten;
    } catch (e) {
      history.push({ iteration: iter, prompt: candidate, failures, error: e.message });
      break;
    }
    failures = evaluatePromptHH(candidate, ctx);
    history.push({ iteration: iter, prompt: candidate, failures });
  }

  onProgress({ stage: "done", iteration: iter, failures });
  return {
    prompt: candidate,
    history,
    passed: failures.length === 0,
    iterations: iter,
  };
}
