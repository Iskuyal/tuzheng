export type VisionModelFailureKind = "timeout" | "upstream" | "invalid-output";

export class VisionModelError extends Error {
  constructor(readonly kind: VisionModelFailureKind, options?: ErrorOptions) {
    const message = kind === "timeout"
      ? "视觉模型请求超时。"
      : kind === "invalid-output"
        ? "视觉模型没有返回可读取的结构化观察值。"
        : "视觉模型请求失败。";
    super(message, options);
    this.name = "VisionModelError";
  }
}
