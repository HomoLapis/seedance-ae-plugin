/**
 * Storyboarder — After Effects Bridge
 *
 * Promisified wrappers around CSInterface.evalScript() for the storyboard
 * panel. Mirrors the style of client/ae-bridge.js but exposes only what
 * Storyboarder needs (scan/place/replace + a few helpers reused from the
 * main panel's host script).
 */
(function () {
    "use strict";

    var csInterface = null;
    try { csInterface = new CSInterface(); }
    catch (e) { console.warn("CSInterface unavailable — running outside AE"); }

    function isInAE() { return csInterface !== null; }

    function evalScript(script) {
        return new Promise(function (resolve, reject) {
            if (!csInterface) { reject(new Error("Not running inside After Effects")); return; }
            csInterface.evalScript(script, function (result) {
                if (result === "EvalScript error.") {
                    reject(new Error("ExtendScript error"));
                    return;
                }
                if (result === "undefined" || result === "") {
                    resolve(null);
                    return;
                }
                try { resolve(JSON.parse(result)); }
                catch (e) { resolve(result); }
            });
        });
    }

    function escapePath(p) { return String(p || "").replace(/\\/g, "/"); }

    /**
     * Serialise a JS value to a string literal that can be embedded into the
     * ExtendScript source we send via evalScript(). Two layers of parsing
     * happen between here and the host function:
     *
     *   1. ExtendScript parses the outer string literal (single-quoted).
     *      → it COLLAPSES \\ → \, \U → U, \D → D, \f → form feed, etc.
     *      Windows paths like "C:\\Users\\flavi\\Desktop\\…" inside our JSON
     *      would lose every backslash here, producing "C:UserslaviDesktop…".
     *   2. JSON.parse on the host side decodes JSON escapes:  \\ → \
     *
     * To get a single backslash through both layers we must inject FOUR
     * backslashes into the source. JSON.stringify already double-escapes
     * (\ → \\), so we double them again here (\\ → \\\\). The host MUST
     * use JSON.parse (not eval) — eval would mishandle \U / \D again.
     */
    function jsonArg(arr) {
        const json = JSON.stringify(arr);
        const safe = json
            .replace(/\\/g, "\\\\")   // every \ → \\  (so post-ExtendScript-parse it's still \\)
            .replace(/'/g,  "\\'");   // escape the single-quote wrapper
        return "'" + safe + "'";
    }

    var Bridge = {
        isInAE: isInAE,
        raw: evalScript,

        // -- Reused from main panel host script -------------------------------
        checkReady:        function () { return evalScript("checkAEReady()"); },
        getProjectDir:     function () { return evalScript("getProjectDir()"); },
        getActiveCompInfo: function () { return evalScript("getActiveCompInfo()"); },
        captureFrameToFile: function (path) {
            return evalScript('captureCurrentFrameToFile("' + escapePath(path) + '")');
        },

        // -- New storyboard-specific calls ------------------------------------
        getWorkAreaInfo:   function () { return evalScript("getWorkAreaInfo()"); },

        scanWorkAreaImages: function () { return evalScript("scanWorkAreaImages()"); },

        placeStoryboardClips: function (shots, useWorkAreaStart) {
            return evalScript(
                "placeStoryboardClips(" + jsonArg(shots) + ", " +
                (useWorkAreaStart ? "true" : "false") + ")"
            );
        },

        insertStoryboardPlaceholders: function (shots, useWorkAreaStart) {
            return evalScript(
                "insertStoryboardPlaceholders(" + jsonArg(shots) + ", " +
                (useWorkAreaStart ? "true" : "false") + ")"
            );
        },

        replacePlaceholdersWithRenders: function (replacements) {
            return evalScript("replacePlaceholdersWithRenders(" + jsonArg(replacements) + ")");
        },

        setWorkArea: function (start, duration) {
            return evalScript("setWorkArea(" + Number(start) + ", " + Number(duration) + ")");
        }
    };

    window.AEBridge = Bridge;
})();
