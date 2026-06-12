import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (!normalized.includes("node_modules")) return undefined;
          if (normalized.includes("/react/") || normalized.includes("/react-dom/")) return "vendor-react";
          if (normalized.includes("/antd/es/icons") || normalized.includes("/antd/lib/icons")) return "vendor-antd-icons";
          if (normalized.includes("/antd/es/locale") || normalized.includes("/antd/lib/locale")) return "vendor-antd-locale";
          if (normalized.includes("/antd/es/") || normalized.includes("/antd/lib/")) {
            const component = normalized.match(/\/antd\/(?:es|lib)\/([^/]+)/)?.[1];
            return component ? `vendor-antd-${component}` : "vendor-antd";
          }
          if (normalized.includes("/antd/")) return "vendor-antd";
          if (normalized.includes("/@ant-design/icons")) return "vendor-ant-design-icons";
          if (normalized.includes("/@ant-design/cssinjs")) return "vendor-ant-design-cssinjs";
          if (normalized.includes("/@ant-design/")) return "vendor-ant-design";
          const rcPackage = normalized.match(/\/node_modules\/(rc-[^/]+)/)?.[1];
          if (rcPackage) return `vendor-${rcPackage}`;
          if (normalized.includes("/markdown-it/") || normalized.includes("/markdown-it-footnote/")) return "vendor-markdown";
          if (normalized.includes("/highlight.js/")) return "vendor-highlight";
          if (normalized.includes("/katex/dist/katex.min.js")) return "vendor-katex-runtime";
          if (normalized.includes("/katex/dist/katex")) return "vendor-katex-core";
          if (normalized.includes("/katex/")) return "vendor-katex-assets";
          if (normalized.includes("/@tauri-apps/")) return "vendor-tauri";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
});
