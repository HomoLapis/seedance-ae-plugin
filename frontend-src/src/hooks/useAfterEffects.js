/**
 * React hook for After Effects integration via the AEBridge.
 * When running inside a CEP panel, provides AE status and import functions.
 * When running standalone, all functions are no-ops.
 */
import { useState, useEffect, useCallback } from "react";

export default function useAfterEffects() {
    const [isAE, setIsAE] = useState(false);
    const [aeReady, setAeReady] = useState(false);
    const [activeComp, setActiveComp] = useState(null);
    // Active comp dimensions, used to pre-select the closest Ratio button.
    // Shape: { name, width, height } | null
    const [activeCompInfo, setActiveCompInfo] = useState(null);

    useEffect(() => {
        // Check if we're inside After Effects
        if (typeof window.AEBridge !== "undefined" && window.AEBridge.isInAfterEffects()) {
            setIsAE(true);

            // Poll AE status every 3 seconds.
            //
            // IMPORTANT: setActiveCompInfo() must keep the SAME reference when
            // the underlying data hasn't changed — otherwise every poll creates
            // a fresh `{name, width, height}` object, which propagates a full
            // re-render through the App tree every 3 s. That re-render is what
            // causes the prompt textarea text and the depth/pose video
            // thumbnails to flicker (the videos re-trigger metadata-fetch on
            // each reconcile in CEP's Chromium build). Compare-and-bail.
            const check = async () => {
                try {
                    const status = await window.AEBridge.checkReady();
                    setAeReady(status.ready && status.hasProject);
                    setActiveComp(status.hasActiveComp ? status.activeCompName : null);
                    if (status.hasActiveComp) {
                        try {
                            const info = await window.AEBridge.getActiveCompInfo();
                            if (info && info.width && info.height) {
                                setActiveCompInfo((prev) => {
                                    if (prev &&
                                        prev.name   === info.name &&
                                        prev.width  === info.width &&
                                        prev.height === info.height) {
                                        return prev; // same data — keep the ref, no re-render
                                    }
                                    return {
                                        name:   info.name,
                                        width:  info.width,
                                        height: info.height,
                                    };
                                });
                            } else {
                                setActiveCompInfo((prev) => prev === null ? prev : null);
                            }
                        } catch {
                            setActiveCompInfo((prev) => prev === null ? prev : null);
                        }
                    } else {
                        setActiveCompInfo((prev) => prev === null ? prev : null);
                    }
                } catch {
                    setAeReady(false);
                    setActiveComp(null);
                    setActiveCompInfo((prev) => prev === null ? prev : null);
                }
            };

            check();
            const interval = setInterval(check, 3000);
            return () => clearInterval(interval);
        }
    }, []);

    /**
     * Import a video file into AE at the current playhead position.
     * @param {string} filePath - Absolute path to the video file
     * @param {string} [layerName] - Optional layer name
     * @returns {Promise<Object>} Result with layer info
     */
    const importToTimeline = useCallback(async (filePath, layerName) => {
        if (!isAE || !window.AEBridge) return null;
        return window.AEBridge.importAndAddToTimeline(filePath, layerName);
    }, [isAE]);

    /**
     * Import multiple videos sequentially at the playhead.
     * @param {string[]} filePaths
     * @param {string} [prefix]
     */
    const importMultipleToTimeline = useCallback(async (filePaths, prefix) => {
        if (!isAE || !window.AEBridge) return null;
        return window.AEBridge.importMultipleToTimeline(filePaths, prefix);
    }, [isAE]);

    return {
        isAE,
        aeReady,
        activeComp,
        activeCompInfo,
        importToTimeline,
        importMultipleToTimeline,
    };
}
