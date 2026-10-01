import "dotenv/config";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { DEFAULT_API_PORT, DEFAULT_WEB_PORT, resolvePort } from "../shared/ports.js";

const apiPort = resolvePort(process.env.PORT, DEFAULT_API_PORT, "API 端口（PORT）");
if (!apiPort.ok) throw new Error(apiPort.message);
const webPort = resolvePort(process.env.WEB_PORT, DEFAULT_WEB_PORT, "网页端口（WEB_PORT）");
if (!webPort.ok) throw new Error(webPort.message);

export default defineConfig({
  root: "web",
  plugins: [vue()],
  server: {
    host: "127.0.0.1",
    port: webPort.port,
    // 端口固定：被占用时直接失败并提示，不再静默换到 5174——README、演示脚本与编辑器配置都写着 5173。
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort.port}`,
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
});
