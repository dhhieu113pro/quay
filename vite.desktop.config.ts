import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Static SPA shell for the Tauri WebView. Live preview keeps vite.config.ts.
export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
  ],
  resolve: { tsconfigPaths: true },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 8080,
    strictPort: true,
    headers: {
      "Permissions-Policy": "geolocation=()",
    },
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
