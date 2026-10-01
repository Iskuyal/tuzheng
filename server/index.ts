import "dotenv/config";
import { DEFAULT_API_PORT, portInUseHint, resolvePort } from "../shared/ports.js";
import { createApp } from "./app.js";

const resolved = resolvePort(process.env.PORT, DEFAULT_API_PORT, "API 端口（PORT）");
if (!resolved.ok) {
  console.error(`[api] ${resolved.message}`);
  process.exit(1);
}

const port = resolved.port;
const app = createApp();

// 注意：不要把「启动成功」的日志写进 app.listen 的回调——Express 5 的 app.listen 会把
// 回调同时注册成 error 处理器（lib/application.js），端口被占用时回调也会被执行，
// 于是会出现「打印了已启动、实际没在监听」的僵尸服务端。改为监听 http.Server 的事件。
const server = app.listen(port, "127.0.0.1");

server.on("listening", () => {
  console.log(`图证服务端已启动：http://127.0.0.1:${port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`[api] ${portInUseHint("API 端口", port)}`);
    process.exit(1);
  }
  console.error(`[api] 服务端启动失败：${error.message}`);
  process.exit(1);
});
