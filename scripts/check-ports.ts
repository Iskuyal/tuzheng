import net from "node:net";
import "dotenv/config";
import { DEFAULT_API_PORT, DEFAULT_WEB_PORT, portInUseHint, resolvePort } from "../shared/ports.js";

/**
 * 启动前端口预检：`npm run dev` 会先跑这个脚本。
 * 为什么需要它：`tsx watch` 在子进程退出后仍会守着不动，所以只靠服务端自己的
 * EADDRINUSE 处理，会出现「API 已退出、命令还挂着、vite 继续跑」的半启动状态。
 * 预检在启动任何东西之前就把忙端口挡下来，并给出可直接照做的清理命令。
 * 预检与真正绑定之间仍有极小的竞争窗口，服务端与 Vite 各自还有兜底（error 处理／strictPort）。
 */
function probe(port: number): Promise<"free" | "busy"> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      resolve(error.code === "EADDRINUSE" ? "busy" : "free");
    });
    server.once("listening", () => {
      server.close(() => resolve("free"));
    });
    server.listen(port, "127.0.0.1");
  });
}

const targets = [
  { label: "API 端口", env: "PORT", raw: process.env.PORT, fallback: DEFAULT_API_PORT },
  { label: "网页端口", env: "WEB_PORT", raw: process.env.WEB_PORT, fallback: DEFAULT_WEB_PORT },
] as const;

const problems: string[] = [];
for (const target of targets) {
  const resolved = resolvePort(target.raw, target.fallback, `${target.label}（${target.env}）`);
  if (!resolved.ok) {
    problems.push(resolved.message);
    continue;
  }
  if ((await probe(resolved.port)) === "busy") {
    problems.push(portInUseHint(target.label, resolved.port));
  }
}

if (problems.length > 0) {
  console.error("[dev] 启动前检查未通过：");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `[dev] 端口检查通过：API ${process.env.PORT ?? DEFAULT_API_PORT}、网页 ${process.env.WEB_PORT ?? DEFAULT_WEB_PORT}`,
);
