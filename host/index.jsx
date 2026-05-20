/**
 * Seedance Studio — After Effects ExtendScript
 *
 * Provides functions callable from the CEP panel via CSInterface.evalScript().
 * Handles: importing video files, adding to active comp, placing at playhead.
 */

/**
 * Get info about the active composition.
 * Returns JSON string or "null" if no comp is active.
 */
function getActiveCompInfo() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return JSON.stringify(null);
    }
    return JSON.stringify({
        name: comp.name,
        width: comp.width,
        height: comp.height,
        duration: comp.duration,
        frameRate: comp.frameRate,
        time: comp.time,
        numLayers: comp.numLayers
    });
}

/**
 * Import a video file into the AE project.
 * Returns JSON with the item index and name, or error.
 */
function importVideoFile(filePath) {
    try {
        var file = new File(filePath);
        if (!file.exists) {
            return JSON.stringify({ error: "File not found: " + filePath });
        }

        var importOptions = new ImportOptions(file);
        var item = app.project.importFile(importOptions);

        return JSON.stringify({
            success: true,
            itemIndex: item.index,
            name: item.name,
            width: item.width,
            height: item.height,
            duration: item.duration
        });
    } catch (e) {
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Import a video file and add it to the active composition at the current playhead position.
 * This is the main function called by the panel after a video is generated and downloaded.
 *
 * @param {string} filePath - Absolute path to the video file
 * @param {string} layerName - Optional name for the layer (pass "" to use default)
 * Returns JSON with layer info or error.
 */
function importAndAddToTimeline(filePath, layerName) {
    try {
        // Check active composition
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition. Please select a composition first." });
        }

        // Import the file
        var file = new File(filePath);
        if (!file.exists) {
            return JSON.stringify({ error: "Video file not found: " + filePath });
        }

        var importOptions = new ImportOptions(file);
        var footageItem = app.project.importFile(importOptions);

        if (!footageItem) {
            return JSON.stringify({ error: "Failed to import file" });
        }

        // Begin undoable action group
        app.beginUndoGroup("Seedance Studio - Add Video");

        // Add to composition as a new layer
        var layer = comp.layers.add(footageItem);

        // Place at current playhead position
        layer.startTime = comp.time;

        // Set layer name if provided
        if (layerName && layerName !== "") {
            layer.name = layerName;
        }

        app.endUndoGroup();

        return JSON.stringify({
            success: true,
            layerName: layer.name,
            layerIndex: layer.index,
            startTime: layer.startTime,
            duration: footageItem.duration,
            compName: comp.name
        });
    } catch (e) {
        try { app.endUndoGroup(); } catch (ignore) {}
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Import multiple video files and add them sequentially to the active composition.
 * Each video is placed one after the other starting from the playhead.
 *
 * @param {string} filePathsJson - JSON array of absolute file paths
 * @param {string} prefix - Name prefix for layers (e.g., "Seedance")
 * Returns JSON with results array.
 */
function importMultipleToTimeline(filePathsJson, prefix) {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition" });
        }

        var filePaths = eval("(" + filePathsJson + ")");
        if (!filePaths || filePaths.length === 0) {
            return JSON.stringify({ error: "No file paths provided" });
        }

        app.beginUndoGroup("Seedance Studio - Add Multiple Videos");

        var currentTime = comp.time;
        var results = [];
        var namePrefix = prefix || "Seedance";

        for (var i = 0; i < filePaths.length; i++) {
            var file = new File(filePaths[i]);
            if (!file.exists) {
                results.push({ error: "File not found: " + filePaths[i] });
                continue;
            }

            var importOptions = new ImportOptions(file);
            var footageItem = app.project.importFile(importOptions);

            var layer = comp.layers.add(footageItem);
            layer.startTime = currentTime;
            layer.name = namePrefix + " " + (i + 1);

            results.push({
                success: true,
                layerName: layer.name,
                startTime: currentTime,
                duration: footageItem.duration
            });

            // Next video starts after this one ends
            currentTime += footageItem.duration;
        }

        app.endUndoGroup();

        return JSON.stringify({ success: true, results: results });
    } catch (e) {
        try { app.endUndoGroup(); } catch (ignore) {}
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Import a still image into the active comp at the playhead.
 * Default duration: 5 seconds (still images have no intrinsic duration).
 *
 * @param {string} filePath
 * @param {string} layerName
 * @param {number} durationSec - how long the image stays on the timeline (default 5)
 */
function importImageAndAddToTimeline(filePath, layerName, durationSec) {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition. Please select a composition first." });
        }
        var file = new File(filePath);
        if (!file.exists) {
            return JSON.stringify({ error: "Image file not found: " + filePath });
        }

        var importOptions = new ImportOptions(file);
        var item = app.project.importFile(importOptions);
        if (!item) return JSON.stringify({ error: "Failed to import image" });

        app.beginUndoGroup("Seedance Studio - Add Image");
        var layer = comp.layers.add(item);
        layer.startTime = comp.time;

        // Stills have no intrinsic duration in AE — set explicitly so it
        // appears on the timeline for a usable length.
        var dur = (typeof durationSec === "number" && durationSec > 0) ? durationSec : 5;
        try { layer.outPoint = layer.inPoint + dur; } catch (eD) {}

        if (layerName && layerName !== "") layer.name = layerName;
        app.endUndoGroup();

        return JSON.stringify({
            success:    true,
            layerName:  layer.name,
            layerIndex: layer.index,
            startTime:  layer.startTime,
            duration:   dur,
            compName:   comp.name,
            width:      item.width,
            height:     item.height
        });
    } catch (e) {
        try { app.endUndoGroup(); } catch (ignore) {}
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Capture the current playhead frame of the active comp as an image and save
 * it to a temp file. Returns { path, width, height, time, compName, format }
 * or { error }.
 *
 * Strategy:
 *   1. Prefer CompItem.saveFrameToPng (AE 24.0+) — fastest, no render-queue UI.
 *   2. Fall back to RenderQueue with PNG Sequence template for older versions.
 *
 * @param {string} targetPath - Absolute path INCLUDING extension (.png) where
 *                              the frame should be written. The folder must exist.
 */
function captureCurrentFrameToFile(targetPath) {
    var rqItem = null;
    var disabled = [];
    var diag = [];
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition. Open a comp and put the playhead on the frame you want." });
        }
        if (!targetPath) return JSON.stringify({ error: "No target path provided." });

        var outFile = new File(targetPath);
        // Make sure parent folder exists
        try { var par = outFile.parent; if (!par.exists) par.create(); } catch (eFolder) {}
        if (!outFile.parent.exists) {
            return JSON.stringify({ error: "Could not create snapshot folder: " + outFile.parent.fsName });
        }

        // Remove any stale file at the target path so we don't accidentally
        // return a previous snapshot that looks like a success.
        try { if (outFile.exists) outFile.remove(); } catch (_) {}

        var t = comp.time;
        diag.push("time=" + t.toFixed(3) + "s");
        diag.push("comp=" + comp.width + "x" + comp.height);

        // ── Path A: CompItem.saveFrameToPng (AE 24.0+) ─────────────────────
        if (typeof comp.saveFrameToPng === "function") {
            diag.push("tryA=saveFrameToPng");
            var errA = null;
            try {
                comp.saveFrameToPng(t, outFile);
            } catch (eDirect) {
                errA = eDirect.toString();
                diag.push("errA=" + errA);
            }
            // saveFrameToPng can silently fail on some AE builds; verify output.
            if (outFile.exists && outFile.length > 100) {
                return JSON.stringify({
                    success:  true,
                    path:     outFile.fsName,
                    bytes:    outFile.length,
                    width:    comp.width,
                    height:   comp.height,
                    time:     t,
                    compName: comp.name,
                    format:   "png",
                    method:   "saveFrameToPng"
                });
            }
            diag.push("A-failed:file-missing-or-empty");
        } else {
            diag.push("A-unavailable");
        }

        // ── Path B: Render Queue (legacy AE, or when A silently fails) ─────
        // Only accept PNG / JPEG templates. Do NOT fall back to "Photoshop"
        // (produces .psd which the React side can't read) or "TIFF" / video
        // containers. If none are available, we throw a clear error below.
        rqItem = app.project.renderQueue.items.add(comp);
        rqItem.timeSpanStart    = t;
        rqItem.timeSpanDuration = 1 / comp.frameRate;

        var om = rqItem.outputModule(1);
        var available = om.templates;
        diag.push("rq-templates=[" + available.join("|") + "]");

        // Match templates flexibly — AE's template names vary by locale/version.
        // "PNG Sequence" is the canonical name; "PNG" also seen on some builds.
        var picked = null;
        var pickedExt = "png";
        var patterns = [
            { re: /^PNG Sequence$/i,  ext: "png" },
            { re: /^PNG$/i,           ext: "png" },
            { re: /PNG/i,             ext: "png" },
            { re: /^JPEG Sequence$/i, ext: "jpg" },
            { re: /^JPEG$/i,          ext: "jpg" },
            { re: /JPEG|JPG/i,        ext: "jpg" },
        ];
        for (var p = 0; p < patterns.length && !picked; p++) {
            for (var a = 0; a < available.length; a++) {
                if (patterns[p].re.test(available[a])) {
                    picked = available[a];
                    pickedExt = patterns[p].ext;
                    break;
                }
            }
        }
        if (!picked) {
            try { rqItem.remove(); } catch (_) {}
            return JSON.stringify({
                error: "After Effects doesn't have a PNG or JPEG output template available. " +
                       "Install a PNG template: Edit → Templates → Output Module, New → Format: " +
                       "PNG Sequence, save as 'PNG Sequence'. Or update AE to 2024+ for native " +
                       "saveFrameToPng support. Diagnostics: " + diag.join(", ")
            });
        }
        diag.push("template=" + picked + " ext=" + pickedExt);
        try { om.applyTemplate(picked); } catch (eT) { diag.push("applyTemplate-err=" + eT.toString()); }

        // Use a unique per-capture prefix so stale files from previous attempts
        // don't get picked up.
        var stamp = new Date().getTime();
        var tempPrefix = "__snap_" + stamp + "_";
        om.file = new File(outFile.parent.fsName + "/" + tempPrefix + "[#####]." + pickedExt);

        // Disable other queued items so only ours renders
        for (var j = 1; j <= app.project.renderQueue.numItems; j++) {
            var it = app.project.renderQueue.item(j);
            if (it !== rqItem && it.status === RQItemStatus.QUEUED) {
                it.render = false;
                disabled.push(j);
            }
        }

        app.project.renderQueue.render();

        // Restore other items
        for (var k = 0; k < disabled.length; k++) {
            try { app.project.renderQueue.item(disabled[k]).render = true; } catch (eR) {}
        }
        try { rqItem.remove(); } catch (eRem) {}
        rqItem = null;

        // Locate the produced file — ONLY those matching this capture's prefix.
        var folder = outFile.parent;
        var produced = null;
        var fl = folder.getFiles(function (f) {
            return (f instanceof File) && f.name.indexOf(tempPrefix) === 0;
        });
        if (fl && fl.length > 0) produced = fl[0];

        if (!produced) {
            return JSON.stringify({
                error: "Render completed but no snapshot file was produced. " +
                       "Check AE's Output Module settings — ensure a PNG / JPEG / Photoshop " +
                       "template exists. Diagnostics: " + diag.join(", ") +
                       ". Folder: " + folder.fsName
            });
        }

        if (produced.length < 100) {
            try { produced.remove(); } catch (_) {}
            return JSON.stringify({
                error: "Render produced an empty file (" + produced.length + " bytes). " +
                       "Template '" + picked + "' did not write a PNG — verify it is a still/sequence template."
            });
        }

        // Rename to the requested targetPath
        var finalPath = produced.fsName;
        try {
            if (outFile.exists) outFile.remove();
            if (produced.rename(outFile.name)) {
                finalPath = outFile.fsName;
            }
        } catch (_) {}

        return JSON.stringify({
            success:  true,
            path:     finalPath,
            bytes:    produced.length,
            width:    comp.width,
            height:   comp.height,
            time:     t,
            compName: comp.name,
            format:   "png",
            method:   "renderQueue",
            template: picked
        });
    } catch (e) {
        try {
            for (var kk = 0; kk < disabled.length; kk++) {
                try { app.project.renderQueue.item(disabled[kk]).render = true; } catch (eX) {}
            }
            if (rqItem) { try { rqItem.remove(); } catch (eY) {} }
        } catch (eZ) {}
        return JSON.stringify({ error: e.toString() + ". Diagnostics: " + diag.join(", ") });
    }
}

/**
 * Get the current playhead time in seconds.
 */
function getPlayheadTime() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return JSON.stringify({ error: "No active composition" });
    }
    return JSON.stringify({ time: comp.time, frameRate: comp.frameRate });
}

/**
 * Return the folder path of the currently saved AE project.
 * Returns { path: "C:\\..." } if saved, { path: null } if unsaved.
 */
function getProjectDir() {
    try {
        if (!app.project || !app.project.file) {
            return JSON.stringify({ path: null });
        }
        return JSON.stringify({ path: app.project.file.parent.fsName });
    } catch (e) {
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Render the work area of the active composition to a temp file, capped at maxDurationSec.
 * The work area is the in/out range marked on the comp's timeline (keys B / N).
 *
 * Returns { path, duration, workAreaStart, compName, template } or { error }.
 */
function renderWorkAreaToFile(maxDurationSec) {
    var rqItem = null;
    var disabled = [];
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition." });
        }

        var maxDur = (maxDurationSec && maxDurationSec > 0) ? maxDurationSec : 15;
        var wStart = comp.workAreaStart;
        var wDur   = Math.min(comp.workAreaDuration, maxDur);

        if (wDur <= 0) {
            return JSON.stringify({
                error: "Work area has zero duration. Set the work area in the timeline: press B at the start, N at the end."
            });
        }

        // Prepare temp folder
        var tempFolder = new Folder(Folder.temp.fsName + "/seedance-ae");
        if (!tempFolder.exists) tempFolder.create();
        var stamp = new Date().getTime();

        // Queue this comp for rendering, limited to the work area slice
        rqItem = app.project.renderQueue.items.add(comp);
        rqItem.timeSpanStart    = wStart;
        rqItem.timeSpanDuration = wDur;

        var om = rqItem.outputModule(1);

        // Pick best available OM template — prefer H.264 (small MP4), fall back to Lossless (MOV)
        var available = om.templates;
        var preferred = [
            "H.264 - Match Render Settings - 5 Mbps",
            "H.264 - Match Render Settings - 15 Mbps",
            "H.264",
            "High Quality",
            "Lossless"
        ];
        var picked = null;
        for (var p = 0; p < preferred.length; p++) {
            for (var a = 0; a < available.length; a++) {
                if (available[a] === preferred[p]) { picked = preferred[p]; break; }
            }
            if (picked) break;
        }
        if (!picked && available.length > 0) picked = available[0];
        if (!picked) picked = "Lossless";
        try { om.applyTemplate(picked); } catch (e1) {
            try { om.applyTemplate("Lossless"); picked = "Lossless"; } catch (e2) {}
        }

        var isH264 = picked.indexOf("H.264") >= 0;
        var ext = isH264 ? "mp4" : "mov";
        var outFile = new File(tempFolder.fsName + "/seedance_ref_" + stamp + "." + ext);
        om.file = outFile;

        // Disable other queued items so only ours renders
        for (var j = 1; j <= app.project.renderQueue.numItems; j++) {
            var it = app.project.renderQueue.item(j);
            if (it !== rqItem && it.status === RQItemStatus.QUEUED) {
                it.render = false;
                disabled.push(j);
            }
        }

        app.project.renderQueue.render();

        // Restore other items
        for (var k = 0; k < disabled.length; k++) {
            try { app.project.renderQueue.item(disabled[k]).render = true; } catch (eR) {}
        }
        try { rqItem.remove(); } catch (eRem) {}
        rqItem = null;

        if (!outFile.exists) {
            return JSON.stringify({ error: "Render completed but output file not found at " + outFile.fsName });
        }

        return JSON.stringify({
            success:       true,
            path:          outFile.fsName,
            duration:      wDur,
            workAreaStart: wStart,
            compName:      comp.name,
            template:      picked
        });
    } catch (e) {
        // Cleanup on error
        try {
            for (var kk = 0; kk < disabled.length; kk++) {
                try { app.project.renderQueue.item(disabled[kk]).render = true; } catch (eX) {}
            }
            if (rqItem) { try { rqItem.remove(); } catch (eY) {} }
        } catch (eZ) {}
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Render the active comp's work area to an AUDIO-ONLY file (WAV / AIFF).
 * Capped at maxDurationSec (default 15). Output goes to the OS temp folder.
 */
function renderWorkAreaAudioToFile(maxDurationSec) {
    var rqItem = null;
    var disabled = [];
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition." });
        }
        if (!comp.hasAudio) {
            return JSON.stringify({ error: "Active composition has no audio to render." });
        }
        var maxDur = (maxDurationSec && maxDurationSec > 0) ? maxDurationSec : 15;
        var wStart = comp.workAreaStart;
        var wDur   = Math.min(comp.workAreaDuration, maxDur);
        if (wDur <= 0) {
            return JSON.stringify({ error: "Work area has zero duration. Press B at the start and N at the end." });
        }

        var tempFolder = new Folder(Folder.temp.fsName + "/seedance-ae");
        if (!tempFolder.exists) tempFolder.create();
        var stamp = new Date().getTime();
        var baseName = "seedance_audio_" + stamp;

        rqItem = app.project.renderQueue.items.add(comp);
        rqItem.timeSpanStart    = wStart;
        rqItem.timeSpanDuration = wDur;

        var om = rqItem.outputModule(1);

        // Prefer audio-only templates. Names vary between AE versions/locales,
        // so match flexibly (case-insensitive, substring).
        var available = om.templates;
        var preferredPatterns = [
            /^wav$/i,
            /^aiff(\s|$)/i,
            /audio\s*only/i,
            /wav/i,
            /aiff/i
        ];
        var picked = null;
        for (var p = 0; p < preferredPatterns.length && !picked; p++) {
            for (var a = 0; a < available.length; a++) {
                if (preferredPatterns[p].test(available[a])) {
                    picked = available[a];
                    break;
                }
            }
        }
        // Last-resort fallback: render with default template (likely video+audio MOV),
        // then re-host the audio track separately is not trivial — just let AE produce
        // whatever it produces and detect the actual file below.
        if (!picked && available.length > 0) picked = available[0];
        if (!picked) picked = "Lossless";
        try { om.applyTemplate(picked); } catch (eT) {}

        // Guess a tentative extension matching the picked template; AE will
        // actually write whatever its output format demands, so we rescan below.
        var tentativeExt = "wav";
        if (/aiff|aif/i.test(picked))      tentativeExt = "aif";
        else if (/mov|quicktime/i.test(picked)) tentativeExt = "mov";
        else if (/h\.?264|mp4/i.test(picked))   tentativeExt = "mp4";
        var outFile = new File(tempFolder.fsName + "/" + baseName + "." + tentativeExt);
        try { om.file = outFile; } catch (eF) {}

        for (var j = 1; j <= app.project.renderQueue.numItems; j++) {
            var it = app.project.renderQueue.item(j);
            if (it !== rqItem && it.status === RQItemStatus.QUEUED) {
                it.render = false;
                disabled.push(j);
            }
        }

        app.project.renderQueue.render();

        for (var k = 0; k < disabled.length; k++) {
            try { app.project.renderQueue.item(disabled[k]).render = true; } catch (eR) {}
        }
        try { rqItem.remove(); } catch (eRem) {}
        rqItem = null;

        // Scan the temp folder for any file that starts with our baseName,
        // since AE may have written with a different extension than we expected.
        var produced = null;
        var files = tempFolder.getFiles(function (f) {
            return (f instanceof File) && f.name.indexOf(baseName) === 0;
        });
        if (files && files.length > 0) {
            // Prefer audio extensions if multiple files were produced
            var audioExts = /\.(wav|aif|aiff|m4a|mp3)$/i;
            for (var fi = 0; fi < files.length; fi++) {
                if (audioExts.test(files[fi].name)) { produced = files[fi]; break; }
            }
            if (!produced) produced = files[0];
        }

        if (!produced) {
            return JSON.stringify({
                error: "Render completed but no output file was found in " + tempFolder.fsName +
                       ". Template applied: '" + picked + "'. Available templates: " +
                       available.join(", ")
            });
        }

        // If AE produced a video-container file (e.g. .mov) instead of audio-only,
        // warn — the audio track is still inside, but the caller may want to know.
        var prodName = produced.name.toLowerCase();
        var isAudioOnly = /\.(wav|aif|aiff|m4a|mp3)$/i.test(prodName);
        var warn = null;
        if (!isAudioOnly) {
            warn = "No audio-only template (WAV/AIFF) available in this AE install. " +
                   "Rendered as '" + picked + "' (" + produced.name + "). " +
                   "Please install/enable a WAV or AIFF output template in Output Module Settings.";
        }

        return JSON.stringify({
            success:       true,
            path:          produced.fsName,
            duration:      wDur,
            workAreaStart: wStart,
            compName:      comp.name,
            template:      picked,
            extension:     prodName.split(".").pop(),
            warn:          warn
        });
    } catch (e) {
        try {
            for (var kk = 0; kk < disabled.length; kk++) {
                try { app.project.renderQueue.item(disabled[kk]).render = true; } catch (eX) {}
            }
            if (rqItem) { try { rqItem.remove(); } catch (eY) {} }
        } catch (eZ) {}
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Get the source file path of the first selected layer in the active comp.
 * Returns { path, name, duration, hasAudio, width, height } or { error }.
 * The layer must be a footage layer whose source is a file on disk (not a still sequence, nested comp, or solid).
 */
function getSelectedLayerFile() {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition." });
        }
        var sel = comp.selectedLayers;
        if (!sel || sel.length === 0) {
            return JSON.stringify({ error: "No layer selected in the active comp." });
        }
        var layer = sel[0];
        if (!(layer.source instanceof FootageItem)) {
            return JSON.stringify({ error: "Selected layer is not a footage layer." });
        }
        var src = layer.source;
        if (!src.mainSource || !src.mainSource.file) {
            return JSON.stringify({ error: "Footage has no file on disk (nested comp / solid / placeholder)." });
        }
        var f = src.mainSource.file;
        if (!f.exists) {
            return JSON.stringify({ error: "Source file missing: " + f.fsName });
        }
        return JSON.stringify({
            success: true,
            path:     f.fsName,
            name:     src.name,
            duration: src.duration,
            width:    src.width,
            height:   src.height,
            hasAudio: !!src.hasAudio,
            layerName: layer.name
        });
    } catch (e) {
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Check if After Effects is ready and has a project open.
 */
function checkAEReady() {
    try {
        var hasProject = app.project !== null && app.project !== undefined;
        var hasActiveComp = false;
        var compName = "";

        if (hasProject && app.project.activeItem && app.project.activeItem instanceof CompItem) {
            hasActiveComp = true;
            compName = app.project.activeItem.name;
        }

        return JSON.stringify({
            ready: true,
            hasProject: hasProject,
            hasActiveComp: hasActiveComp,
            activeCompName: compName
        });
    } catch (e) {
        return JSON.stringify({ ready: false, error: e.toString() });
    }
}

/**
 * Create a new composition sized to match a video.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} duration - in seconds
 * @param {number} frameRate
 * @param {string} compName
 */
function createCompForVideo(width, height, duration, frameRate, compName) {
    try {
        app.beginUndoGroup("Seedance Studio - New Comp");

        var name = compName || "Seedance Comp";
        var comp = app.project.items.addComp(name, width, height, 1, duration, frameRate);

        app.endUndoGroup();

        return JSON.stringify({
            success: true,
            compName: comp.name,
            width: comp.width,
            height: comp.height
        });
    } catch (e) {
        try { app.endUndoGroup(); } catch (ignore) {}
        return JSON.stringify({ error: e.toString() });
    }
}

/* ========================================================================
 *  STORYBOARDER PANEL — ExtendScript helpers
 * ======================================================================== */

/**
 * Get info about the active comp's WORK AREA.
 * Returns { compName, width, height, frameRate, duration, workAreaStart,
 *          workAreaDuration, time } or { error }.
 */
function getWorkAreaInfo() {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition." });
        }
        return JSON.stringify({
            success:          true,
            compName:         comp.name,
            width:            comp.width,
            height:           comp.height,
            pixelAspect:      comp.pixelAspect,
            frameRate:        comp.frameRate,
            duration:         comp.duration,
            workAreaStart:    comp.workAreaStart,
            workAreaDuration: comp.workAreaDuration,
            time:             comp.time,
            numLayers:        comp.numLayers
        });
    } catch (e) {
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Scan the active comp's work area for IMAGE layers (still footage with a file
 * source) and return them ordered by inPoint. Used for "Sync from work area":
 * the user lays out frames on the timeline and we read them as storyboard
 * shots. Pairs of consecutive images become first/last frames of a shot.
 *
 * Returns { items: [{ index, name, inPoint, outPoint, path, width, height }], ... }
 */
function scanWorkAreaImages() {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition." });
        }
        var waStart = comp.workAreaStart;
        var waEnd   = waStart + comp.workAreaDuration;
        var items = [];
        var stillExt = /\.(png|jpg|jpeg|tif|tiff|bmp|psd|webp)$/i;

        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (!layer || !layer.enabled) continue;
            if (!(layer.source instanceof FootageItem)) continue;
            var src = layer.source;
            if (!src.mainSource || !src.mainSource.file) continue;
            var f = src.mainSource.file;
            if (!stillExt.test(f.name)) continue;
            // Layer must overlap the work area
            if (layer.outPoint <= waStart) continue;
            if (layer.inPoint  >= waEnd)   continue;
            items.push({
                aeIndex:   layer.index,
                name:      layer.name,
                inPoint:   layer.inPoint,
                outPoint:  layer.outPoint,
                path:      f.fsName,
                width:     src.width,
                height:    src.height,
                labelColor: layer.label
            });
        }
        // Sort by inPoint ascending
        items.sort(function (a, b) { return a.inPoint - b.inPoint; });

        return JSON.stringify({
            success:         true,
            compName:        comp.name,
            workAreaStart:   waStart,
            workAreaDuration: comp.workAreaDuration,
            frameRate:       comp.frameRate,
            count:           items.length,
            items:           items
        });
    } catch (e) {
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Place a batch of generated storyboard CLIPS into the active comp.
 *
 * shotsJson is a JSON array of:
 *   { path: "...", name: "...", prompt: "...",
 *     startTime: <sec>, durationHint: <sec>,
 *     labelColor: 1-16, marker: true|false, shotIndex: 1.. }
 *
 * If `useWorkAreaStart` is true, all startTime values are interpreted as
 * offsets from comp.workAreaStart. Otherwise they're absolute comp times.
 *
 * Each clip is added as a new layer, sized via outPoint = inPoint + duration
 * of the imported footage (Seedance clips have a fixed duration). Layer name,
 * AE label color (1-16) and an optional comp marker at the layer's inPoint
 * are applied for visual identification.
 */
function placeStoryboardClips(shotsJson, useWorkAreaStart) {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition." });
        }
        // Use JSON.parse — eval() would re-interpret \U / \D / \f inside
        // Windows paths and silently corrupt them. The bridge double-escapes
        // backslashes so JSON.parse receives valid JSON here.
        var shots = JSON.parse(shotsJson);
        if (!shots || shots.length === 0) {
            return JSON.stringify({ error: "No shots provided." });
        }

        app.beginUndoGroup("Storyboarder - Place clips");

        var baseTime = useWorkAreaStart ? comp.workAreaStart : 0;
        var results = [];

        // Find or create a folder bin for storyboard footage
        var folder = null;
        for (var k = 1; k <= app.project.numItems; k++) {
            var it = app.project.item(k);
            if (it instanceof FolderItem && it.name === "Storyboard") { folder = it; break; }
        }
        if (!folder) folder = app.project.items.addFolder("Storyboard");

        for (var i = 0; i < shots.length; i++) {
            var s = shots[i];
            try {
                var file = new File(s.path);
                if (!file.exists) {
                    results.push({ shotIndex: s.shotIndex, error: "File not found: " + s.path });
                    continue;
                }
                var importOptions = new ImportOptions(file);
                var footageItem = app.project.importFile(importOptions);
                try { footageItem.parentFolder = folder; } catch (eFold) {}

                var layer = comp.layers.add(footageItem);
                layer.startTime = baseTime + (s.startTime || 0);
                if (s.name && s.name !== "") layer.name = s.name;
                if (typeof s.labelColor === "number" && s.labelColor >= 0 && s.labelColor <= 16) {
                    try { layer.label = s.labelColor; } catch (eLab) {}
                }

                // Set outPoint to clip duration if we know it
                var clipDur = footageItem.duration;
                if (clipDur > 0) {
                    try { layer.outPoint = layer.inPoint + clipDur; } catch (eDur) {}
                }

                if (s.marker === true) {
                    try {
                        var mt = layer.inPoint;
                        var marker = new MarkerValue(s.prompt ? String(s.prompt).substring(0, 200) : (s.name || "Shot " + s.shotIndex));
                        try { marker.chapter = "Shot " + (s.shotIndex || (i + 1)); } catch (eCh) {}
                        comp.markerProperty.setValueAtTime(mt, marker);
                    } catch (eMark) {}
                }

                results.push({
                    shotIndex: s.shotIndex || (i + 1),
                    layerName: layer.name,
                    layerIndex: layer.index,
                    startTime: layer.startTime,
                    duration: clipDur
                });
            } catch (eShot) {
                results.push({ shotIndex: s.shotIndex || (i + 1), error: eShot.toString() });
            }
        }

        app.endUndoGroup();
        return JSON.stringify({ success: true, compName: comp.name, results: results });
    } catch (e) {
        try { app.endUndoGroup(); } catch (ignore) {}
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Insert IMAGE PLACEHOLDERS (storyboard preview frames) into the active comp.
 * The user sees the storyboard visually in AE, can shift/retime each shot,
 * then clicks "Replace placeholders with renders" to swap them with the
 * generated videos (matched by layer-name prefix "SBPH-XX-").
 */
function insertStoryboardPlaceholders(shotsJson, useWorkAreaStart) {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition." });
        }
        var shots = JSON.parse(shotsJson);  // see note in placeStoryboardClips
        if (!shots || shots.length === 0) {
            return JSON.stringify({ error: "No shots provided." });
        }

        app.beginUndoGroup("Storyboarder - Insert placeholders");

        var baseTime = useWorkAreaStart ? comp.workAreaStart : 0;
        var results = [];

        // Find or create folder bin
        var folder = null;
        for (var k = 1; k <= app.project.numItems; k++) {
            var it = app.project.item(k);
            if (it instanceof FolderItem && it.name === "Storyboard") { folder = it; break; }
        }
        if (!folder) folder = app.project.items.addFolder("Storyboard");

        for (var i = 0; i < shots.length; i++) {
            var s = shots[i];
            try {
                if (!s.path) {
                    results.push({ shotIndex: s.shotIndex, error: "No image path." });
                    continue;
                }
                var file = new File(s.path);
                if (!file.exists) {
                    results.push({ shotIndex: s.shotIndex, error: "File not found: " + s.path });
                    continue;
                }
                var importOptions = new ImportOptions(file);
                var item = app.project.importFile(importOptions);
                try { item.parentFolder = folder; } catch (eFold) {}

                var layer = comp.layers.add(item);
                layer.startTime = baseTime + (s.startTime || 0);
                // Placeholder name uses a recognisable prefix so we can swap it later
                layer.name = "SBPH-" + pad2(s.shotIndex || (i + 1)) + "-" +
                             (s.label || ("shot-" + (s.shotIndex || (i + 1))));
                if (typeof s.labelColor === "number" && s.labelColor >= 0 && s.labelColor <= 16) {
                    try { layer.label = s.labelColor; } catch (eLab) {}
                }
                // Stills have no intrinsic duration — set explicit out-point
                var dur = (typeof s.durationHint === "number" && s.durationHint > 0) ? s.durationHint : 5;
                try { layer.outPoint = layer.inPoint + dur; } catch (eDur) {}

                if (s.marker === true) {
                    try {
                        var marker = new MarkerValue(s.prompt ? String(s.prompt).substring(0, 200) : layer.name);
                        try { marker.chapter = "Shot " + (s.shotIndex || (i + 1)); } catch (eCh) {}
                        comp.markerProperty.setValueAtTime(layer.inPoint, marker);
                    } catch (eMark) {}
                }

                results.push({
                    shotIndex: s.shotIndex || (i + 1),
                    layerName: layer.name,
                    startTime: layer.startTime,
                    duration: dur
                });
            } catch (eShot) {
                results.push({ shotIndex: s.shotIndex || (i + 1), error: eShot.toString() });
            }
        }

        app.endUndoGroup();
        return JSON.stringify({ success: true, compName: comp.name, results: results });
    } catch (e) {
        try { app.endUndoGroup(); } catch (ignore) {}
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Replace placeholder image layers (named "SBPH-XX-...") with generated video
 * clips. Matching is by shot index (the "XX" in the placeholder's name).
 *
 * replacementsJson: [{ shotIndex: N, videoPath: "...", layerName: "...",
 *                      labelColor: 1-16, prompt: "...", marker: true|false }]
 *
 * The placeholder's startTime (in/out range from the user's manual editing)
 * is preserved on the new video layer, so the user's timing edits survive
 * the swap. The placeholder is then removed.
 */
function replacePlaceholdersWithRenders(replacementsJson) {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition." });
        }
        var reps = JSON.parse(replacementsJson);  // see note in placeStoryboardClips
        if (!reps || reps.length === 0) {
            return JSON.stringify({ error: "No replacements provided." });
        }

        app.beginUndoGroup("Storyboarder - Replace placeholders");

        // Folder for imported video clips
        var folder = null;
        for (var k = 1; k <= app.project.numItems; k++) {
            var it = app.project.item(k);
            if (it instanceof FolderItem && it.name === "Storyboard") { folder = it; break; }
        }
        if (!folder) folder = app.project.items.addFolder("Storyboard");

        var results = [];

        for (var r = 0; r < reps.length; r++) {
            var rep = reps[r];
            var idx = rep.shotIndex;
            var prefix = "SBPH-" + pad2(idx) + "-";

            // Locate placeholder layer by name prefix
            var placeholder = null;
            for (var i = 1; i <= comp.numLayers; i++) {
                var L = comp.layer(i);
                if (L && L.name && L.name.indexOf(prefix) === 0) { placeholder = L; break; }
            }
            if (!placeholder) {
                results.push({ shotIndex: idx, error: "Placeholder not found: " + prefix + "*" });
                continue;
            }

            try {
                var startTime = placeholder.startTime;
                var inPt      = placeholder.inPoint;
                var outPt     = placeholder.outPoint;
                var phLabel   = placeholder.label;

                var file = new File(rep.videoPath);
                if (!file.exists) {
                    results.push({ shotIndex: idx, error: "Video not found: " + rep.videoPath });
                    continue;
                }
                var importOptions = new ImportOptions(file);
                var footageItem = app.project.importFile(importOptions);
                try { footageItem.parentFolder = folder; } catch (eFold) {}

                var newLayer = comp.layers.add(footageItem);
                newLayer.startTime = startTime;
                if (rep.layerName && rep.layerName !== "") newLayer.name = rep.layerName;
                var lc = (typeof rep.labelColor === "number") ? rep.labelColor : phLabel;
                if (typeof lc === "number" && lc >= 0 && lc <= 16) {
                    try { newLayer.label = lc; } catch (eLab) {}
                }
                // Keep the user's in/out edits where possible (clipped to clip length)
                try {
                    var clipDur = footageItem.duration;
                    var keepDur = Math.min(outPt - inPt, clipDur);
                    newLayer.outPoint = newLayer.inPoint + keepDur;
                } catch (eDur) {}

                // Move the new layer just above the placeholder, then delete it
                try { newLayer.moveBefore(placeholder); } catch (eMv) {}
                try { placeholder.remove(); } catch (eRm) {}

                if (rep.marker === true) {
                    try {
                        var mk = new MarkerValue(rep.prompt ? String(rep.prompt).substring(0, 200) : newLayer.name);
                        try { mk.chapter = "Shot " + idx; } catch (eCh) {}
                        comp.markerProperty.setValueAtTime(newLayer.inPoint, mk);
                    } catch (eMark) {}
                }

                results.push({ shotIndex: idx, layerName: newLayer.name, startTime: newLayer.startTime });
            } catch (eRep) {
                results.push({ shotIndex: idx, error: eRep.toString() });
            }
        }

        app.endUndoGroup();
        return JSON.stringify({ success: true, results: results });
    } catch (e) {
        try { app.endUndoGroup(); } catch (ignore) {}
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Set the work area of the active comp to [start, start+duration].
 * Used after auto-layout so the user sees the full storyboard inside the
 * work area at a glance.
 */
function setWorkArea(start, duration) {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition." });
        }
        if (typeof start !== "number" || start < 0) start = 0;
        if (typeof duration !== "number" || duration <= 0) {
            return JSON.stringify({ error: "Invalid duration." });
        }
        // Keep within comp duration
        if (start + duration > comp.duration) {
            try { comp.duration = start + duration + 1; } catch (eDur) {}
        }
        comp.workAreaStart    = start;
        comp.workAreaDuration = duration;
        return JSON.stringify({
            success: true,
            workAreaStart: comp.workAreaStart,
            workAreaDuration: comp.workAreaDuration,
            compDuration: comp.duration
        });
    } catch (e) {
        return JSON.stringify({ error: e.toString() });
    }
}

/** Helper: zero-pad to 2 digits as a string. ExtendScript-safe. */
function pad2(n) {
    n = String(n || "0");
    return n.length < 2 ? ("0" + n) : n;
}
