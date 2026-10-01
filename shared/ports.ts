/**
 * 运行时端口：服务端、Vite 配置与开发脚本共用同一套解析规则。
 * 端口从根目录 `.env` 读取，启动进程里的同名环境变量优先（`dotenv` 不覆盖已存在的值）。
 * 网页端口固定、且开启 strictPort——被占用时直接报错，不再静默换到 5174，
 * 否则 README、文档里的地址与 WebStorm 的运行配置会对不上。
 */
export const DEFAULT_API_PORT = 3001;
export const DEFAULT_WEB_PORT = 5173;

export type PortResolution = { ok: true; port: number } | { ok: false; message: string };

/** 解析端口：未设置时用默认值；非整数或超出 1—65535 时返回可读的错误信息。 */
export function resolvePort(raw: string | undefined, fallback: number, label: string): PortResolution {
  if (raw === undefined || raw.trim() === "") return { ok: true, port: fallback };
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return { ok: false, message: `${label} 必须是 1—65535 的整数，当前值是「${raw.trim()}」。` };
  }
  return { ok: true, port: value };
}

/** 端口被占用时的可操作提示：先清旧实例，或换端口。 */
export function portInUseHint(label: string, port: number): string {
  return `${label} ${port} 已被占用。请先停掉正在运行的旧实例（Windows：netstat -ano | findstr :${port} 找到 PID，再 taskkill /F /PID <PID>），或用 .env 里的端口设置换一个再启动。`;
}
