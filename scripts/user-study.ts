/** 只生成匿名计划和描述性统计；不招募，不调用模型，不把空模板当实测。 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { writeNewJson } from "./candidate-preflight.js";

const rowSchema = z.object({ participant: z.string().regex(/^P0[1-8]$/), task: z.enum(["T1", "T2", "T3", "T4"]),
  set: z.enum(["A", "B"]), block: z.union([z.literal(1), z.literal(2)]), condition: z.enum(["manual", "product"]),
  execution: z.enum(["manual", "offline-product", "live-product", "evidence-card"]).nullable(),
  state: z.enum(["pending", "completed", "failed", "abandoned"]), success: z.boolean().nullable(), seconds: z.number().finite().nonnegative().nullable(),
  hints: z.number().int().nonnegative().nullable(), misjudged: z.boolean().nullable(), evidenceExplained: z.boolean().nullable(), pendingUnderstood: z.boolean().nullable(),
  response: z.string(), evidence: z.string(), failureReason: z.string(),
}).strict();
export const studySchema = z.object({ schemaVersion: z.literal(1), studyId: z.string().min(1), candidateHash: z.string().nullable(),
  participants: z.array(z.object({ id: z.string().regex(/^P0[1-8]$/), consent: z.boolean(), eligible: z.boolean(), note: z.string() }).strict()).length(8),
  records: z.array(rowSchema).length(64),
}).strict();
export type Study = z.infer<typeof studySchema>;
export function createStudyTemplate(): Study {
  const participants = Array.from({ length: 8 }, (_, index) => ({ id: `P0${index + 1}`, consent: false, eligible: false, note: "待负责人招募并取得同意；不填写姓名或联系方式。" }));
  const records: Study["records"] = [];
  for (const [index, participant] of participants.entries()) for (const block of [1, 2] as const) for (const task of ["T1", "T2", "T3", "T4"] as const) {
    const manual = index % 2 === 0 ? block === 1 : block === 2;
    records.push({ participant: participant.id, task, block, set: block === 1 ? "A" : "B", condition: manual ? "manual" : "product",
      execution: null, state: "pending", success: null, seconds: null, hints: null, misjudged: null, evidenceExplained: null,
      pendingUnderstood: null, response: "", evidence: "", failureReason: "" });
  }
  return { schemaVersion: 1, studyId: "reader-study-preparation-2026-10-07", candidateHash: null, participants, records };
}
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length
  ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null; };
export function summarizeStudy(value: unknown) {
  const study = studySchema.parse(value); const ids = study.participants.map(p => p.id);
  if (new Set(ids).size !== 8) throw new Error("匿名参与者编号重复。");
  const expected = createStudyTemplate().records;
  const key = (r: Study["records"][number]) => `${r.participant}/${r.task}/${r.block}/${r.set}/${r.condition}`;
  const keys = new Set(expected.map(key));
  for (const row of study.records) {
    if (!keys.delete(key(row))) throw new Error("记录重复或改变交叉安排，不能缩小分母。");
    if (row.state === "pending") {
      if ([row.success, row.seconds, row.hints, row.misjudged, row.evidenceExplained, row.pendingUnderstood, row.execution].some(v => v !== null)
        || row.response || row.evidence || row.failureReason) throw new Error("待测记录不能填入实测结果。");
      continue;
    }
    const participant = study.participants.find(p => p.id === row.participant)!;
    if (!participant.consent || !participant.eligible) throw new Error("实测记录必须来自已同意且符合目标用户的参与者。");
    if (!row.execution || !row.response || !row.evidence) throw new Error("实测记录缺操作类型、逐人原答或观察依据。");
    if (row.condition === "manual" && row.execution !== "manual" || row.condition === "product" && row.execution === "manual") throw new Error("条件与操作类型不一致。");
    if (row.state === "completed" && (row.success === null || row.seconds === null || row.hints === null)) throw new Error("完成记录缺判定、计时或提示次数。");
    if (row.state !== "completed" && (row.success !== false || !row.failureReason)) throw new Error("失败/放弃记录必须保留失败原因并计不成功。");
  }
  const attempted = study.records.filter(r => r.state !== "pending");
  const group = (rows: Study["records"]) => ({ planned: rows.length, attempted: rows.filter(r => r.state !== "pending").length,
    pending: rows.filter(r => r.state === "pending").length, success: rows.filter(r => r.state !== "pending" && r.success === true).length,
    failed: rows.filter(r => r.state === "failed").length, abandoned: rows.filter(r => r.state === "abandoned").length,
    medianSeconds: median(rows.flatMap(r => r.seconds === null ? [] : [r.seconds])), missingTime: rows.filter(r => r.state !== "pending" && r.seconds === null).length,
    hints: rows.reduce((sum, r) => sum + (r.hints ?? 0), 0), missingHints: rows.filter(r => r.state !== "pending" && r.hints === null).length,
    misjudgments: rows.filter(r => r.misjudged === true).length, missingJudgments: rows.filter(r => r.state !== "pending" && r.misjudged === null).length,
    evidenceExplained: rows.filter(r => r.evidenceExplained === true).length,
    missingEvidenceExplanation: rows.filter(r => r.state !== "pending" && r.evidenceExplained === null).length,
    pendingUnderstood: rows.filter(r => r.pendingUnderstood === true).length,
    missingPendingUnderstanding: rows.filter(r => r.state !== "pending" && r.pendingUnderstood === null).length });
  const pairs = ids.flatMap(participant => ["T1", "T2", "T3", "T4"].map(task => {
    const manual = study.records.find(r => r.participant === participant && r.task === task && r.condition === "manual")!;
    const product = study.records.find(r => r.participant === participant && r.task === task && r.condition === "product")!;
    const measured = manual.state !== "pending" && product.state !== "pending" && manual.seconds !== null && product.seconds !== null;
    return { participant, task, execution: product.execution, measured, comparableProductFlow: measured && product.execution === "live-product",
      productMinusManualSeconds: measured ? product.seconds! - manual.seconds! : null,
      manualSuccess: manual.success, productSuccess: product.success };
  }));
  return { studyId: study.studyId, participantsObserved: new Set(attempted.map(r => r.participant)).size, total: group(study.records),
    conditions: { manual: group(study.records.filter(r => r.condition === "manual")), product: group(study.records.filter(r => r.condition === "product")) },
    executionGroups: Object.fromEntries(["manual", "offline-product", "live-product", "evidence-card"].map(mode => [mode, group(attempted.filter(r => r.execution === mode))])),
    pairs, conclusion: attempted.length ? "仅描述实际逐人记录；证据卡不等于产品操作，小样本不支持普遍效率或商业结论。" : "尚无真实用户记录，不能得出收益结论。" };
}
export async function main(argv: string[]) {
  if (argv.length !== 2 || !["--template", "--report"].includes(argv[0]) || argv[1].startsWith("--")) throw new Error("使用 --template 新JSON路径 或 --report 已填写JSON路径。");
  if (argv[0] === "--template") { await writeNewJson(argv[1], createStudyTemplate()); console.log("8位匿名编号、64条计划记录已生成。0位实测用户；0次模型请求。"); }
  else console.log(JSON.stringify(summarizeStudy(JSON.parse(await readFile(resolve(argv[1]), "utf8"))), null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
