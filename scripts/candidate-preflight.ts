/** 冻结当前候选代码与两套输入；默认不读取模型配置、不建立客户端、不发请求。 */
import { readdir, readFile, mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadBundle, runtimeSha256, sha256 } from "./holdout-evaluation.js";
import { captureProvenance, type EvaluationProvenance } from "./source-audit-recording.js";
import type { SourceAuditQuestions } from "./evaluate-source-audit.js";
import { questionsCatalog, expectationsCatalog, verifyFrozenSetup } from "./evaluate-source-audit.js";

export const DEMO_IDS = ["q04-caption-yoy-value-as-mom", "q05-caption-wrong-month-distractor", "q13-inference-mom-contradicted", "q18-clarify-basis-resume", "q20-rewrite-replace-and-qualify"];
const roots = ["server", "shared", "scripts", "web", "config", "tests", "e2e", ".github/workflows"];
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const lockSchema = z.object({ schemaVersion: z.literal(1), createdAt: z.string(), kind: z.literal("candidate-preflight"),
  holdoutManifestHash: hashSchema, files: z.record(z.string(), hashSchema),
  provenance: z.custom<EvaluationProvenance>(value => Boolean(value && typeof value === "object")),
  plans: z.object({ holdout: z.object({ repeats: z.literal(3), paths: z.literal(108), stages: z.literal(126), maxHttpRequests: z.literal(360) }),
    demo: z.object({ ids: z.array(z.string()), repeats: z.literal(3), arm: z.literal("retrieval"), initialStages: z.literal(15), maxRecoveryStages: z.literal(3) }) }),
  blockers: z.array(z.string()), modelRequests: z.literal(0),
}).strict();
export type CandidateLock = z.infer<typeof lockSchema>;

async function runtimeFiles(): Promise<string[]> {
  const walk = async (directory: string): Promise<string[]> => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry =>
    entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat();
  return [...(await Promise.all(roots.map(walk))).flat(), "package.json", "package-lock.json"]
    .filter(path => !path.startsWith("web/public/")).sort();
}
export async function prepareCandidate(): Promise<CandidateLock> {
  const bundle = await loadBundle();
  const problems = await verifyFrozenSetup(questionsCatalog, expectationsCatalog);
  if (problems.length) throw new Error(`演示开发题冻结核验失败：${problems.join("；")}`);
  const catalog = JSON.parse(await readFile("samples/source-audit-questions.json", "utf8")) as SourceAuditQuestions;
  for (const id of DEMO_IDS) if (!catalog.questions.some(q => q.id === id)) throw new Error(`演示题号不存在：${id}`);
  const files = Object.fromEntries(await Promise.all((await runtimeFiles()).map(async path => [path, runtimeSha256(await readFile(path))])));
  return lockSchema.parse({ schemaVersion: 1, kind: "candidate-preflight", createdAt: new Date().toISOString(), holdoutManifestHash: bundle.manifestHash,
    files, provenance: await captureProvenance(catalog),
    plans: { holdout: { repeats: 3, paths: 108, stages: 126, maxHttpRequests: 360 },
      demo: { ids: DEMO_IDS, repeats: 3, arm: "retrieval", initialStages: 15, maxRecoveryStages: 3 } },
    blockers: ["负责人逐题抽查并签字", "指定实际HTTP调用上限或落实另行金额控制并授权运行", "当前候选代码尚未在线复验", "最终材料验收按 docs/submission/README.md 的当前未完成条件执行"], modelRequests: 0 });
}
export async function verifyCandidate(value: unknown): Promise<CandidateLock> {
  const lock = lockSchema.parse(value); const bundle = await loadBundle();
  if (bundle.manifestHash !== lock.holdoutManifestHash) throw new Error("预留题冻结包与候选锁不一致。");
  const paths = await runtimeFiles();
  if (JSON.stringify(paths) !== JSON.stringify(Object.keys(lock.files).sort())) throw new Error("候选运行文件集合改变，请另建候选锁。");
  for (const path of paths) if (runtimeSha256(await readFile(path)) !== lock.files[path]) throw new Error(`候选运行文件改变：${path}`);
  const catalog = JSON.parse(await readFile("samples/source-audit-questions.json", "utf8")) as SourceAuditQuestions;
  const current = await captureProvenance(catalog);
  if (JSON.stringify(current.fingerprints) !== JSON.stringify(lock.provenance.fingerprints)) throw new Error("演示题面、期望、来源、图片或提示词漂移。");
  if (current.code.sha !== lock.provenance.code.sha) throw new Error("代码SHA改变，请另建候选锁。");
  if (JSON.stringify(lock.plans.demo.ids) !== JSON.stringify(DEMO_IDS)) throw new Error("演示计划题号改变。");
  return lock;
}
export const reviewSchema = z.object({ candidateHash: hashSchema, reviewer: z.string().trim().min(1), reviewedAt: z.string().min(1),
  questions: z.array(z.object({ id: z.string(), approved: z.literal(true), note: z.string().trim().min(1) }).strict()).length(12) }).strict();
export function verifyReview(review: unknown, lock: CandidateLock, questionIds: string[]) {
  const parsed = reviewSchema.parse(review);
  if (parsed.candidateHash !== sha256(JSON.stringify(lock))) throw new Error("负责人签字不属于当前候选锁。");
  if (JSON.stringify(parsed.questions.map(q => q.id).sort()) !== JSON.stringify([...questionIds].sort())) throw new Error("负责人抽查必须覆盖12题且不重复。");
  return parsed;
}
export async function writeNewJson(path: string, value: unknown) {
  const target = resolve(path); await mkdir(dirname(target), { recursive: true });
  const file = await open(target, "wx");
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); } finally { await file.close(); }
}
export async function main(argv: string[]) {
  if (argv.length !== 2 || !["--prepare", "--verify"].includes(argv[0]) || !argv[1] || argv[1].startsWith("--")) throw new Error("使用 --prepare 新锁路径 或 --verify 已有锁路径；此入口不执行在线评测。");
  if (argv[0] === "--prepare") {
    const lock = await prepareCandidate(); await writeNewJson(argv[1], lock);
    console.log(`候选锁已保存：${resolve(argv[1])}\n签字candidateHash：${sha256(JSON.stringify(lock))}\n108条三臂路径／126阶段；演示15次初查、最多3次恢复。0次模型请求，未读取密钥。`);
  } else { await verifyCandidate(JSON.parse(await readFile(resolve(argv[1]), "utf8"))); console.log("候选代码与输入指纹核验通过。0次模型请求。"); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
});
