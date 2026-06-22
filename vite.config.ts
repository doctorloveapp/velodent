import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    host: true,
    allowedHosts: ["localhost", "127.0.0.1", "velodent.local", ".local"],
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:1422",
        changeOrigin: true
      },
      "/health": {
        target: "http://127.0.0.1:1422",
        changeOrigin: true
      },
      "/pair": {
        target: "http://127.0.0.1:1422",
        changeOrigin: true
      }
    }
  },
  envPrefix: ["VITE_", "TAURI_"],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  build: {
    target: "es2022",
    minify: "esbuild"
  },
  test: {
    globals: true,
    environment: "node"
  }
});
