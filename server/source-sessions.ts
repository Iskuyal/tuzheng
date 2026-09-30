import { createHash, randomUUID } from "node:crypto";
import type { SourceInvestigationDriver } from "./source-investigation.js";
import type { SourceInvestigationResult } from "../shared/source-audit.js";

/** 会话默认有效期：追问提出后用户通常几分钟内回答，超过即过期，要求重新发起核验。 */
export const SOURCE_SESSION_TTL_MS = 30 * 60_000;
/** 同时保留的可恢复会话上限，超出后淘汰最早的，避免长期占用驱动器与图片内存。 */
export const SOURCE_SESSION_MAX = 16;

export interface SourceSession {
  id: string;
  /** 图片字节 + 配文 的 SHA-256；任何一侧改动都会在恢复时失配。 */
  fingerprint: string;
  /** 同一段对话的驱动器：恢复必须续在原对话上，不能新开。 */
  driver: SourceInvestigationDriver;
  /** 最近一次结果（补证前是初查，补证后是恢复段结果）。 */
  result: SourceInvestigationResult;
  createdAt: number;
}

/** 输入指纹：图片与配文任一改动都会得到不同值，用于过期恢复与改动失效校验。 */
export function inputFingerprint(image: Buffer, caption: string): string {
  return createHash("sha256").update(image).update("\n").update(caption).digest("hex");
}

export interface SourceSessionStoreOptions {
  ttlMs?: number;
  max?: number;
  /** 可注入时钟，便于测试过期。 */
  now?: () => number;
}

/**
 * 来源核验的可恢复会话存储：investigate 保存驱动器与输入指纹，
 * resume 校验指纹一致后在同一段对话上续跑。只存在于本机内存，过期即淘汰。
 */
export class SourceSessionStore {
  private readonly sessions = new Map<string, SourceSession>();
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly now: () => number;

  constructor(options: SourceSessionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? SOURCE_SESSION_TTL_MS;
    this.max = options.max ?? SOURCE_SESSION_MAX;
    this.now = options.now ?? Date.now;
  }

  /** 保存一次可恢复的调查；返回其 ID。写入前先清理过期与超额会话。 */
  create(input: { fingerprint: string; driver: SourceInvestigationDriver; result: SourceInvestigationResult }): string {
    this.sweep();
    const id = randomUUID();
    this.sessions.set(id, {
      id,
      fingerprint: input.fingerprint,
      driver: input.driver,
      result: input.result,
      createdAt: this.now(),
    });
    // 超出上限时淘汰最早创建的会话。
    while (this.sessions.size > this.max) {
      const oldest = [...this.sessions.values()].reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
      this.sessions.delete(oldest.id);
    }
    return id;
  }

  /** 取出会话；过期或不存在返回 null（调用方据此拒绝恢复）。 */
  get(id: string): SourceSession | null {
    this.sweep();
    const session = this.sessions.get(id);
    if (!session) return null;
    if (this.now() - session.createdAt > this.ttlMs) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  /** 恢复段结束后更新会话里的最新结果（同一 ID，同一段对话）。 */
  update(id: string, result: SourceInvestigationResult): void {
    const session = this.sessions.get(id);
    if (session) session.result = result;
  }

  private sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, session] of this.sessions) {
      if (session.createdAt <= cutoff) this.sessions.delete(id);
    }
  }
}
