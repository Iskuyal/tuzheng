/** 单独的受控在线入口；原eval:holdout继续只做离线。本文本不构成费用授权。 */
import "dotenv/config";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { activeProviderConfig, createModelSettingsStore, type ProviderConfig, type ModelProvider } from "../server/model-settings.js";
import { loadBundle, runEvaluation, sha256, type Evaluation } from "./holdout-evaluation.js";
import { createHttpTransports, HttpBudget, HttpStoppedError, type HttpRecord } from "./holdout-http.js";
import { verifyCandidate, verifyReview, type CandidateLock } from "./candidate-preflight.js";

/** 单个独占目录；逐HTTP fsync追加日志，逐阶段原子替换快照。失败不覆盖旧轮次。 */
export async function createRunWriter(directory: string) {
  const target = resolve(directory); await mkdir(dirname(target), { recursive: true }); await mkdir(target);
  const journal = await open(resolve(target, "events.jsonl"), "wx");
  return { directory: target,
    async event(type: string, value: unknown) { await journal.writeFile(JSON.stringify({ type, savedAt: new Date().toISOString(), value }) + "\n"); await journal.sync(); },
    async snapshot(value: unknown) {
      const temp = resolve(target, `${randomUUID()}.tmp`); const file = await open(temp, "wx");
      try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); } finally { await file.close(); }
      try { await rename(temp, resolve(target, "report.json")); } finally { await rm(temp, { force: true }); }
    },
    async close() { await journal.close(); },
  };
}
export interface HttpEvaluationReport extends Evaluation {
  comparisons: Array<{ questionId: string; repeat: number; CvsA: "gain" | "no-gain" | "regression" | "not-completed";
    CvsB: "gain" | "no-gain" | "regression" | "not-completed" }>;
  transport: { kind: "actual-http" | "injected-http-fixture"; maxRequests: number; requests: HttpRecord[]; stopReason: string | null;
    amount: null; amountNote: string; state: "running" | "complete" | "stopped" };
  candidateHash: string; runtime: { provider: ModelProvider; model: string; baseUrl: string; configSource: string };
}
export async function runHttpEvaluation(options: { config: ProviderConfig; provider: ModelProvider; configSource: string;
  candidate: CandidateLock; maxRequests: number; output: string; fetchImpl?: typeof fetch }) {
  const bundle = await loadBundle();
  const writer = await createRunWriter(options.output); let current: HttpEvaluationReport | null = null;
  const budget = new HttpBudget({ maxRequests: options.maxRequests, fetchImpl: options.fetchImpl,
    persist: record => writer.event("http", record) });
  const safeRuntime = { provider: options.provider, model: options.config.model, baseUrl: options.config.baseUrl, configSource: options.configSource };
  const decorate = (snapshot: Evaluation): HttpEvaluationReport => ({ ...snapshot,
    // 原冻结汇总保留；未完成配对不能由false==false被解释为模型无增益。
    comparisons: snapshot.summary.pairs.map(pair => {
      const compare = (base: "A-direct" | "B-full-context") => {
        const rows = snapshot.rows.filter(r => r.questionId === pair.questionId && r.repeat === pair.repeat && [base, "C-tools"].includes(r.arm));
        return rows.some(r => r.state === "planned") ? "not-completed" as const
          : pair.success["C-tools"] === pair.success[base] ? "no-gain" as const : pair.success["C-tools"] ? "gain" as const : "regression" as const;
      };
      return { questionId: pair.questionId, repeat: pair.repeat, CvsA: compare("A-direct"), CvsB: compare("B-full-context") };
    }),
    candidateHash: sha256(JSON.stringify(options.candidate)), runtime: safeRuntime,
    transport: { kind: options.fetchImpl ? "injected-http-fixture" : "actual-http", maxRequests: options.maxRequests,
      requests: structuredClone(budget.records), stopReason: budget.stopReason, amount: null,
      amountNote: "按实际HTTP请求次数硬限制；未核实单价，金额未知，不声明金额封顶。",
      state: budget.stopReason ? "stopped" : snapshot.rows.some(r => r.state === "planned") ? "running" : "complete" } });
  try {
    await writer.event("initialization", { candidate: options.candidate, runtime: safeRuntime, maxRequests: options.maxRequests });
    await runEvaluation(bundle, createHttpTransports(options.provider, options.config, budget), {
      repeats: 3, mode: options.fetchImpl ? "offline-fixture" : "live",
      checkpoint: async snapshot => {
        if (budget.records.length >= options.maxRequests && snapshot.rows.some(r => r.state === "planned")) budget.halt("达到实际HTTP请求上限。");
        current = decorate(snapshot); await writer.snapshot(current);
        await writer.event("stage-checkpoint", { rows: snapshot.rows.filter(r => r.state !== "planned").map(r => ({ pathId: r.pathId, phase: r.phase, state: r.state })), summary: snapshot.summary });
        if (budget.stopReason) throw new HttpStoppedError(budget.stopReason);
      },
    });
  } catch (error) {
    if (!(error instanceof HttpStoppedError) || !current) throw error;
  } finally { await writer.close(); }
  if (!current) throw new Error("没有生成计划快照。");
  return current as HttpEvaluationReport;
}
export function parseLiveArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!["--execute", "--lock", "--review", "--max-requests", "--output"].includes(key) || args.has(key)) throw new Error("未知或重复参数。");
    if (key === "--execute") args.set(key, "true");
    else { const value = argv[++index]; if (!value || value.startsWith("--")) throw new Error(`缺少参数：${key}`); args.set(key, value); }
  }
  if (!args.has("--execute")) throw new Error("此入口只有显式 --execute 才可能运行；准备或核验请用 eval:preflight。");
  for (const key of ["--lock", "--review", "--max-requests", "--output"]) if (!args.has(key)) throw new Error(`收费运行前须明确：${key}`);
  const maxRequests = Number(args.get("--max-requests"));
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 360) throw new Error("实际HTTP调用授权上限必须是1—360的整数。");
  return { lock: args.get("--lock")!, review: args.get("--review")!, output: args.get("--output")!, maxRequests };
}
export async function main(argv: string[]) {
  const args = parseLiveArgs(argv);
  const candidate = await verifyCandidate(JSON.parse(await readFile(resolve(args.lock), "utf8")));
  const bundle = await loadBundle(); verifyReview(JSON.parse(await readFile(resolve(args.review), "utf8")), candidate, bundle.questions.map(q => q.id));
  const store = createModelSettingsStore(); const { provider, config } = activeProviderConfig(await store.read());
  if (!config.apiKey) throw new Error("当前配置缺少密钥，请通过现有设置页或完整环境配置提供。");
  const report = await runHttpEvaluation({ ...args, candidate, config, provider, configSource: store.source ?? "file" });
  console.log(`实际HTTP尝试 ${report.transport.requests.filter(r => r.attempted).length}/${args.maxRequests}；${report.transport.state}；金额未知。结果：${resolve(args.output, "report.json")}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
});
