/** 模型提供方（协议）：服务端与设置页共用同一份定义。 */
export const MODEL_PROVIDERS = ["openai-responses", "anthropic"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];
