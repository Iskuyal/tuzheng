/** 五题最终复验的受控入口：复用原评分/恢复流程，只替换HTTP传输接缝。 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { activeProviderConfig, createModelSettingsStore, type ProviderConfig, type ModelProvider } from "../server/model-settings.js";
import { questionsCatalog, expectationsCatalog, runPairedEvaluation, type EvaluationReport } from "./evaluate-source-audit.js";
import { createHttpTransports, HttpBudget, HttpStoppedError } from "./holdout-http.js";
import { verifyCandidate, type CandidateLock } from "./candidate-preflight.js";
import { createRunWriter } from "./run-holdout-http.js";
import { sha256 } from "./holdout-evaluation.js";
import { sourceInvestigationPrompt } from "../server/source-prompt.js";

export function parseDemoArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!["--execute", "--lock", "--max-requests", "--output"].includes(key) || args.has(key)) throw new Error("未知或重复参数。");
    if (key === "--execute") args.set(key, "true");
    else { const value = argv[++index]; if (!value || value.startsWith("--")) throw new Error(`缺少参数：${key}`); args.set(key, value); }
  }
  if (!args.has("--execute")) throw new Error("五题收费复验须显式 --execute；预检使用 eval:preflight。");
  for (const key of ["--lock", "--max-requests", "--output"]) if (!args.has(key)) throw new Error(`收费复验前须明确：${key}`);
  const maxRequests = Number(args.get("--max-requests"));
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 360) throw new Error("HTTP调用上限须为1—360整数。");
  return { lock: args.get("--lock")!, output: args.get("--output")!, maxRequests };
}
export async function runDemoHttp(options: { candidate: CandidateLock; config: ProviderConfig; provider: ModelProvider;
  configSource: string; maxRequests: number; output: string; fetchImpl?: typeof fetch }) {
  const ids = options.candidate.plans.demo.ids;
  const questions = { ...questionsCatalog, questions: questionsCatalog.questions.filter(q => ids.includes(q.id)) };
  const expectations = { ...expectationsCatalog, questions: expectationsCatalog.questions.filter(e => ids.includes(e.id)) };
  const images = new Map(await Promise.all([...new Set(questions.questions.map(q => q.image))].map(async id =>
    [id, await readFile(join(questionsCatalog.imageDirectory, `${id}.png`))] as const)));
  const writer = await createRunWriter(options.output);
  const budget = new HttpBudget({ maxRequests: options.maxRequests, fetchImpl: options.fetchImpl, persist: r => writer.event("http", r) });
  const transports = createHttpTransports(options.provider, options.config, budget);
  let latest: EvaluationReport | null = null;
  const decorate = (report: EvaluationReport) => ({ ...report, mode: options.fetchImpl ? "offline-fixture" : "live", scope: "final-demo-five-questions",
    candidateHash: sha256(JSON.stringify(options.candidate)), runtime: { provider: options.provider, model: options.config.model,
      baseUrl: options.config.baseUrl, configSource: options.configSource }, transport: {
      kind: options.fetchImpl ? "injected-http-fixture" : "actual-http", requests: structuredClone(budget.records), maxRequests: options.maxRequests,
      stopReason: budget.stopReason, amount: null, state: budget.stopReason ? "stopped" : report.state,
    } });
  try {
    await writer.event("initialization", { candidateHash: sha256(JSON.stringify(options.candidate)), scope: "final-demo", maxRequests: options.maxRequests });
    await runPairedEvaluation(questions, expectations, { runs: 3, arms: ["retrieval"],
      driverFactory: question => transports.tools({ arm: "C-tools", questionId: question.id, phase: "before",
        caption: question.caption, image: images.get(question.image)!, mimeType: "image/png", prompt: sourceInvestigationPrompt({ retrieval: true }), documents: [], prior: null, answer: null }),
      onCheckpoint: async report => {
        if (budget.records.length >= options.maxRequests && report.records.some(r => ["pending", "running"].includes(r.status))) budget.halt("达到实际HTTP请求上限。");
        latest = report; await writer.snapshot(decorate(report));
        await writer.event("stage-checkpoint", { state: report.state, records: report.records.map(r => ({ attemptId: r.attemptId, status: r.status })), summary: report.summary });
        if (budget.stopReason) throw new HttpStoppedError(budget.stopReason);
      },
    });
  } catch (error) { if (!(error instanceof HttpStoppedError) || !latest) throw error; }
  finally { await writer.close(); }
  if (!latest) throw new Error("未生成五题计划快照。");
  return decorate(latest);
}
export async function main(argv: string[]) {
  const args = parseDemoArgs(argv); const candidate = await verifyCandidate(JSON.parse(await readFile(resolve(args.lock), "utf8")));
  const store = createModelSettingsStore(); const { config, provider } = activeProviderConfig(await store.read());
  if (!config.apiKey) throw new Error("当前配置缺少密钥。");
  const report = await runDemoHttp({ ...args, candidate, config, provider, configSource: store.source ?? "file" });
  console.log(`五题复验HTTP尝试 ${report.transport.requests.filter(r => r.attempted).length}/${args.maxRequests}；${report.transport.state}；金额未知。记录：${resolve(args.output, "report.json")}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
});
