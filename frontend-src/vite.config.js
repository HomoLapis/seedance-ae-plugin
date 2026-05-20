import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BUILD_TARGET=cep emits straight into ../client/ so the CEP panel
// picks up the new bundle on next AE launch. Otherwise it builds a
// plain web app in ./dist that you can `vite preview` in a browser
// (useful for UI iteration without round-tripping through After Effects).
const isCEPBuild = process.env.BUILD_TARGET === "cep";

export default defineConfig({
  plugins: [react()],
  base: isCEPBuild ? "./" : "/",
  build: isCEPBuild
    ? {
        outDir: "../client",
        emptyOutDir: false, // keep CSInterface.js, ae-bridge.js, index.html
        rollupOptions: {
          output: {
            entryFileNames: "assets/index.js",
            chunkFileNames: "assets/[name].js",
            assetFileNames: "assets/[name].[ext]",
          },
        },
      }
    : {},
  server: {
    port: 5173,
  },
});
