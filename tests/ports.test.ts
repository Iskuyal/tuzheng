import { describe, expect, it } from "vitest";
import { DEFAULT_API_PORT, DEFAULT_WEB_PORT, portInUseHint, resolvePort } from "../shared/ports.js";

describe("运行时端口解析", () => {
  it("默认值：未设置或留空时用调用方给的默认端口", () => {
    expect(resolvePort(undefined, DEFAULT_API_PORT, "API 端口（PORT）")).toEqual({ ok: true, port: 3001 });
    expect(resolvePort("", DEFAULT_WEB_PORT, "网页端口（WEB_PORT）")).toEqual({ ok: true, port: 5173 });
    expect(resolvePort("   ", DEFAULT_WEB_PORT, "网页端口（WEB_PORT）")).toEqual({ ok: true, port: 5173 });
  });

  it("自定义值：接受 1—65535 的整数（含两端）并去掉首尾空白", () => {
    expect(resolvePort("3456", DEFAULT_API_PORT, "API 端口（PORT）")).toEqual({ ok: true, port: 3456 });
    expect(resolvePort(" 5200 ", DEFAULT_WEB_PORT, "网页端口（WEB_PORT）")).toEqual({ ok: true, port: 5200 });
    expect(resolvePort("1", DEFAULT_API_PORT, "API 端口（PORT）")).toEqual({ ok: true, port: 1 });
    expect(resolvePort("65535", DEFAULT_API_PORT, "API 端口（PORT）")).toEqual({ ok: true, port: 65535 });
  });

  it("非法值：非整数或越界时给出带标签与当前值的错误，不回退到默认端口", () => {
    for (const bad of ["0", "-1", "65536", "3001.5", "abc", "３００１"]) {
      const result = resolvePort(bad, DEFAULT_API_PORT, "API 端口（PORT）");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("API 端口（PORT）");
        expect(result.message).toContain("1—65535");
      }
    }
  });

  it("占用提示里带端口号与清进程命令，方便直接照做", () => {
    const hint = portInUseHint("网页端口", 5173);
    expect(hint).toContain("5173");
    expect(hint).toContain("netstat -ano | findstr :5173");
    expect(hint).toContain("taskkill /F /PID");
  });
});
