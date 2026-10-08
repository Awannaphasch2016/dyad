import path from "path";
import { defineConfig } from "vite";

// The preload script bundles IPC contracts. A value import such as
// `@/lib/formula/phases` must resolve here the same way it does for main.
// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
