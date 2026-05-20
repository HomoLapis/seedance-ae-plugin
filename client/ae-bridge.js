/**
 * Seedance Studio — After Effects Bridge
 *
 * Bridges the CEP panel (HTML/JS) with After Effects via CSInterface.
 * Provides a clean async API for the React frontend to interact with AE.
 */

(function () {
    "use strict";

    // CSInterface instance
    var csInterface = null;
    try {
        csInterface = new CSInterface();
    } catch (e) {
        console.warn("CSInterface not available — running outside After Effects");
    }

    /**
     * Check if we're running inside After Effects CEP panel.
     */
    function isInAfterEffects() {
        return csInterface !== null;
    }

    /**
     * Promisified wrapper for CSInterface.evalScript.
     * Parses JSON responses automatically.
     */
    function evalScript(script) {
        return new Promise(function (resolve, reject) {
            if (!csInterface) {
                reject(new Error("Not running inside After Effects"));
                return;
            }
            csInterface.evalScript(script, function (result) {
                if (result === "EvalScript error." || result === "undefined") {
                    reject(new Error("ExtendScript error: " + result));
                    return;
                }
                try {
                    resolve(JSON.parse(result));
                } catch (e) {
                    resolve(result);
                }
            });
        });
    }

    /**
     * Escape a file path for use in ExtendScript string literals.
     */
    function escapePath(filePath) {
        return filePath.replace(/\\/g, "/");
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    var AEBridge = {
        isInAfterEffects: isInAfterEffects,

        /**
         * Check if AE is ready and has a project/comp open.
         */
        checkReady: function () {
            return evalScript("checkAEReady()");
        },

        /**
         * Get info about the active composition.
         */
        getActiveCompInfo: function () {
            return evalScript("getActiveCompInfo()");
        },

        /**
         * Get the current playhead time.
         */
        getPlayheadTime: function () {
            return evalScript("getPlayheadTime()");
        },

        /**
         * Get the folder path of the currently saved AE project.
         * Returns { path: "C:\\..." } or { path: null } if project not saved.
         */
        getProjectDir: function () {
            return evalScript("getProjectDir()");
        },

        /**
         * Import a video file into AE project and add it to the active
         * composition at the current playhead position.
         *
         * @param {string} filePath - Absolute path to the video file
         * @param {string} [layerName] - Optional layer name
         * @returns {Promise<Object>} Result with layer info
         */
        importAndAddToTimeline: function (filePath, layerName) {
            var escaped = escapePath(filePath);
            var name = layerName || "";
            return evalScript(
                'importAndAddToTimeline("' + escaped + '", "' + name + '")'
            );
        },

        /**
         * Import a still image into the active comp at the playhead.
         * @param {string} filePath
         * @param {string} [layerName]
         * @param {number} [durationSec=5]
         */
        importImageAndAddToTimeline: function (filePath, layerName, durationSec) {
            var escaped = escapePath(filePath);
            var name = layerName || "";
            var dur = (typeof durationSec === "number" && durationSec > 0) ? durationSec : 5;
            return evalScript(
                'importImageAndAddToTimeline("' + escaped + '", "' + name + '", ' + dur + ')'
            );
        },

        /**
         * Import multiple video files sequentially into the active composition.
         *
         * @param {string[]} filePaths - Array of absolute paths
         * @param {string} [prefix] - Layer name prefix
         * @returns {Promise<Object>} Results for each import
         */
        importMultipleToTimeline: function (filePaths, prefix) {
            var escaped = filePaths.map(function (p) {
                return escapePath(p);
            });
            var json = JSON.stringify(escaped);
            var pfx = prefix || "Seedance";
            return evalScript(
                "importMultipleToTimeline('" + json + "', '" + pfx + "')"
            );
        },

        /**
         * Create a new composition sized for a video.
         */
        createCompForVideo: function (width, height, duration, frameRate, name) {
            return evalScript(
                "createCompForVideo(" +
                    width + ", " + height + ", " +
                    duration + ", " + frameRate + ', "' +
                    (name || "Seedance Comp") + '")'
            );
        },

        /**
         * Import a single video file (without adding to comp).
         */
        importVideoFile: function (filePath) {
            var escaped = escapePath(filePath);
            return evalScript('importVideoFile("' + escaped + '")');
        },

        /**
         * Get the source file path of the first selected layer in the active comp.
         * Used to pick a reference video/audio directly from the AE timeline.
         */
        getSelectedLayerFile: function () {
            return evalScript("getSelectedLayerFile()");
        },

        /**
         * Render the active comp's work area (capped at maxDurationSec, default 15s)
         * to a temp file and return its path.
         */
        renderWorkAreaToFile: function (maxDurationSec) {
            var d = (typeof maxDurationSec === "number" && maxDurationSec > 0) ? maxDurationSec : 15;
            return evalScript("renderWorkAreaToFile(" + d + ")");
        },

        /**
         * Render the active comp's work area as an AUDIO-ONLY file (WAV/AIFF).
         */
        renderWorkAreaAudioToFile: function (maxDurationSec) {
            var d = (typeof maxDurationSec === "number" && maxDurationSec > 0) ? maxDurationSec : 15;
            return evalScript("renderWorkAreaAudioToFile(" + d + ")");
        },

        /**
         * Capture the current playhead frame to a PNG file at `targetPath`.
         * `targetPath` must be an absolute path including the .png extension;
         * the parent folder is created automatically.
         */
        captureCurrentFrameToFile: function (targetPath) {
            var escaped = escapePath(targetPath);
            return evalScript('captureCurrentFrameToFile("' + escaped + '")');
        },
    };

    // Expose globally so React app can access it
    window.AEBridge = AEBridge;
})();
