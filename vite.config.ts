import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [vue()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
});
