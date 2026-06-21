import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    basicSsl({
      domains: ["velodent.local", "localhost", "127.0.0.1"],
      name: "velodent-local",
      ttlDays: 3650
    })
  ],
  clearScreen: false,
  server: {
    allowedHosts: ["velodent.local"],
    port: 1420,
    strictPort: true
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
