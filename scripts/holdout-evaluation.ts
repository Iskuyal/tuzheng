/** 独立预留评测：不创建模型客户端；传输与工作流 driver 必须由调用方注入。 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { z } from "zod";
import { runSourceInvestigation, type SourceInvestigationDriver } from "../server/source-investigation.js";
import { sourceInvestigationPrompt } from "../server/source-prompt.js";
import { sourceToolDeclarations } from "../server/source-tools.js";
import { SOURCE_LIBRARY, type SourceDocument } from "../shared/source-library.js";
import { type SourceInvestigationResult } from "../shared/source-audit.js";

export const ARMS = ["A-direct", "B-full-context", "C-tools"] as const;
export type Arm = typeof ARMS[number];
export const PACK = resolve("samples/holdout-v1");
export const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
/** Git/Windows换行转换不算逻辑修改；冻结输入和图片仍采用原始字节SHA。 */
export const runtimeSha256 = (bytes: Buffer) => sha256(bytes.toString("utf8").replaceAll("\r\n", "\n"));
const status = z.enum(["source-match", "source-mismatch", "source-pending", "inference-unsupported", "not-verifiable"]);
const basis = z.enum(["year-on-year", "month-on-month"]).nullable();
const direction = z.enum(["up", "down"]).nullable();
const fields = {
  claimText: z.string().min(1), fromImage: z.boolean(), kind: z.enum(["direct", "inference", "opinion"]),
  metric: z.string().nullable(), period: z.string().nullable(), scope: z.string().nullable(), basis,
  value: z.number().finite().nullable(), direction,
};
export const outputSchema = z.object({
  claims: z.array(z.object({ ...fields, status, officialValue: z.number().finite().nullable(),
    sourceIds: z.array(z.string()), revisionFrom: z.string().nullable(),
  }).strict()).max(6),
  clarification: z.object({ field: z.enum(["basis", "scope", "period", "metric", "value"]),
    claimText: z.string(), question: z.string().min(1),
  }).strict().nullable(),
  stopReason: z.string().min(1),
  rewrites: z.array(z.object({ claimText: z.string(), suggestedText: z.string() }).strict()),
}).strict();
export type Output = z.infer<typeof outputSchema>;
export interface Question { id: string; categories: string[]; image: string; caption: string;
  supplement?: { answer: string; field: string; claimText: string }; }
export interface ExpectedClaim extends z.infer<z.ZodObject<typeof fields>> {
  status: z.infer<typeof status>; officialValue: number | null; sourceIds: string[]; revisionFrom: string | null;
}
export interface PhaseExpectation { claims: ExpectedClaim[];
  stop: "none" | "basis" | "scope" | "no-source" | "inference-gap";
  rewrites: Array<{ claimText: string; allowed: string[] }>;
}
export interface Expectation { id: string; rationale: string; before: PhaseExpectation; after?: PhaseExpectation }
export interface Bundle { questions: Question[]; expectations: Expectation[]; corpus: SourceDocument[];
  prompts: Record<Arm, string>; manifestHash: string; }

export async function loadBundle(directory = PACK): Promise<Bundle> {
  await verifyPack(directory);
  const json = async (path: string) => JSON.parse(await readFile(resolve(directory, path), "utf8"));
  const prompts = Object.fromEntries(await Promise.all(ARMS.map(async arm =>
    [arm, await readFile(resolve(directory, `prompts/${arm}.txt`), "utf8")])));
  return { questions: (await json("questions.json")).questions,
    expectations: (await json("expectations.json")).questions, corpus: await json("corpus.json"),
    prompts: prompts as Record<Arm, string>, manifestHash: sha256(await readFile(resolve(directory, "manifest.json"))) };
}

/** 只核验，绝不自动更新锁；manifest 的哈希另写在运行记录中。 */
export async function verifyPack(directory = PACK): Promise<void> {
  const manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")) as {
    files: Record<string, string>; runtime: Record<string, string>; runtimeHashMode: string;
  };
  const walk = async (path: string): Promise<string[]> => (await Promise.all((await readdir(path, { withFileTypes: true }))
    .map(entry => entry.isDirectory() ? walk(resolve(path, entry.name)) : [resolve(path, entry.name)]))).flat();
  const files = (await walk(directory)).map(file => relative(directory, file).replaceAll("\\", "/"))
    .filter(file => file !== "manifest.json").sort();
  if (JSON.stringify(files) !== JSON.stringify(Object.keys(manifest.files).sort())) throw new Error("冻结包文件集合改变。");
  for (const file of files) {
    if (sha256(await readFile(resolve(directory, file))) !== manifest.files[file]) throw new Error(`冻结文件改变：${file}`);
  }
  if (manifest.runtimeHashMode !== "utf8-lf") throw new Error("未知运行代码指纹格式。");
  for (const [file, hash] of Object.entries(manifest.runtime)) {
    if (runtimeSha256(await readFile(resolve(file))) !== hash) throw new Error(`冻结运行代码改变：${file}`);
  }
  const questions = JSON.parse(await readFile(resolve(directory, "questions.json"), "utf8")).questions as Question[];
  const expectations = JSON.parse(await readFile(resolve(directory, "expectations.json"), "utf8")).questions as Expectation[];
  if (questions.length !== 12 || new Set(questions.map(q => q.id)).size !== 12) throw new Error("必须是12道独立题。");
  if (JSON.stringify(questions.map(q => q.id)) !== JSON.stringify(expectations.map(e => e.id))) throw new Error("题目与期望不对应。");
  const old = JSON.parse(await readFile(resolve("samples/source-audit-questions.json"), "utf8")).questions as Question[];
  for (const q of questions) {
    if (old.some(o => o.id === q.id || normalize(o.caption) === normalize(q.caption))) throw new Error(`与开发题重复：${q.id}`);
    if (!manifest.files[q.image]) throw new Error(`图片未冻结：${q.id}`);
  }
  for (const category of ["支持", "矛盾", "口径缺失", "无适用来源", "推断", "版本替代"]) {
    if (!questions.some(q => q.categories.includes(category))) throw new Error(`缺类别：${category}`);
  }
  const corpus = await readFile(resolve(directory, "corpus.json"), "utf8");
  if (corpus !== `${JSON.stringify(SOURCE_LIBRARY, null, 2)}\n`) throw new Error("运行资料库与冻结资料不一致。");
  if (await readFile(resolve(directory, "prompts/C-tools.txt"), "utf8") !== sourceInvestigationPrompt({ retrieval: true })) {
    throw new Error("现有工作流提示词漂移。");
  }
  if (await readFile(resolve(directory, "tool-declarations.json"), "utf8") !== `${JSON.stringify(sourceToolDeclarations, null, 2)}\n`) {
    throw new Error("工具声明漂移。");
  }
}

export interface ModelInput { arm: Arm; questionId: string; phase: "before" | "after";
  prompt: string; caption: string; image: Buffer; mimeType: "image/png";
  documents: readonly SourceDocument[]; prior: Output | null; answer: string | null; }
/** 不传图片转录、分类、期望、算式或负责人复核备注。 */
export async function buildInput(bundle: Bundle, question: Question, arm: Arm,
  phase: "before" | "after" = "before", prior: Output | null = null, directory = PACK): Promise<ModelInput> {
  return { arm, questionId: question.id, phase, prompt: bundle.prompts[arm], caption: question.caption,
    image: await readFile(resolve(directory, question.image)), mimeType: "image/png",
    documents: arm === "B-full-context" ? structuredClone(bundle.corpus) : [],
    prior, answer: phase === "after" ? question.supplement?.answer ?? null : null };
}

export interface RequestRecord { status: "ok" | "failed"; inputTokens: number | null; outputTokens: number | null;
  durationMs: number; parameters?: unknown; }
export interface DirectSession { requests: RequestRecord[];
  send(input: ModelInput): Promise<{ raw: unknown; model: string }>; }
export interface Transports { direct(input: ModelInput): DirectSession;
  tools(input: ModelInput): SourceInvestigationDriver; }
export interface Metric { passed: number; total: number; rate: number | null }
const metric = (passed: number, total: number): Metric => ({ passed, total, rate: total ? passed / total : null });
const normalize = (text: string) => text.replace(/[\s，。、；：！？,;:!?]/g, "")
  .replace(/\.(?!\d)|(?<!\d)\./g, "").replaceAll("％", "%").toLowerCase();
const rewriteNormalize = (text: string) => normalize(text.replace(/-?\d+(?:\.\d+)?/g, token => String(Number(token))));
const metricName = (text: string | null) => text && ["CPI", "全国CPI", "居民消费价格", "居民消费价格指数", "全国居民消费价格"].includes(text)
  ? "全国居民消费价格" : text;
const caliberMatches = (c: Output["claims"][number], e: ExpectedClaim) => metricName(c.metric) === metricName(e.metric)
  && ["period", "scope", "basis", "kind"].every(key => same(c[key as keyof typeof c], e[key as keyof ExpectedClaim]));
const same = (a: unknown, b: unknown) => typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : a === b;

export interface Judgment { coverage: Metric; numeric: Metric; caliber: Metric; direction: Metric;
  factual: Metric; citations: Metric; citationCoverage: Metric; stop: Metric; wrongRewrite: Metric;
  rewriteCoverage: Metric; groundedClaims: Metric; success: boolean; problems: string[]; }
/** 独立期望评分；绝不拿生产 concludeClaimSource 的输出当正确答案。 */
export function judgeOutput(expected: PhaseExpectation, output: Output | null, visibleIds: readonly string[]): Judgment {
  const claims = output?.claims ?? [];
  const matched = expected.claims.map(e => claims.filter(c => c.fromImage === e.fromImage && normalize(c.claimText) === normalize(e.claimText)));
  const problems: string[] = [];
  let coverage = 0, numeric = 0, caliber = 0, directions = 0, factual = 0, grounded = 0, citationCoverage = 0;
  const visible = new Set(visibleIds);
  const definitive = (c: ExpectedClaim) => c.status === "source-match" || c.status === "source-mismatch";
  for (const [index, e] of expected.claims.entries()) {
    const matches = matched[index]; const c = matches.length === 1 ? matches[0] : null;
    if (!c) { problems.push(`主张遗漏或重复：${e.claimText}`); continue; }
    coverage++;
    const numericOk = same(c.value, e.value) && same(c.officialValue, e.officialValue);
    const caliberOk = caliberMatches(c, e);
    const directionOk = c.direction === e.direction;
    const factOk = c.status === e.status;
    numeric += Number(numericOk && (e.value !== null || e.officialValue !== null));
    caliber += Number(caliberOk); directions += Number(directionOk && e.direction !== null); factual += Number(factOk);
    const cited = caliberOk && c.sourceIds.length > 0 && c.sourceIds.every(id => visible.has(id) && e.sourceIds.includes(id));
    citationCoverage += Number(definitive(e) && cited);
    const evidenceOk = definitive(e) ? cited : c.sourceIds.length === 0;
    const versionOk = !e.revisionFrom || c.revisionFrom === e.revisionFrom;
    grounded += Number(numericOk && caliberOk && directionOk && factOk && evidenceOk && versionOk);
    if (!(numericOk && caliberOk && directionOk && factOk && evidenceOk && versionOk)) problems.push(`结论或依据不满足独立期望：${e.claimText}`);
  }
  // 多余主张、非法引用与不适用的额外引用也记错，不能靠增加猜测提高覆盖。
  let validCitations = 0, totalCitations = 0;
  for (const c of claims) {
    const e = expected.claims.find(e => e.fromImage === c.fromImage && normalize(e.claimText) === normalize(c.claimText));
    if (!e) problems.push(`题面没有的主张：${c.claimText}`);
    for (const id of c.sourceIds) {
      totalCitations++;
      if (visible.has(id) && e?.sourceIds.includes(id) && caliberMatches(c, e)) validCitations++;
      else problems.push(`无效数值引用：${id}`);
    }
  }
  const stopped = expected.stop === "none" ? output !== null && output.clarification === null
    : expected.stop === "basis" || expected.stop === "scope"
      ? output?.clarification?.field === expected.stop && expected.claims.some(e => !e.fromImage
        && normalize(e.claimText) === normalize(output.clarification?.claimText ?? ""))
      : output !== null && output.clarification === null && output.stopReason.trim().length > 0
        && expected.claims.filter(e => !definitive(e)).every(e => {
          const c = claims.find(c => c.fromImage === e.fromImage && normalize(c.claimText) === normalize(e.claimText));
          return c?.status === e.status && c.officialValue === null && c.sourceIds.length === 0;
        });
  if (!stopped) problems.push("停止或追问不恰当。");
  let wrongRewrites = 0, rewriteCoverage = 0;
  const rewritten = new Set<string>();
  for (const rewrite of output?.rewrites ?? []) {
    const rule = expected.rewrites.find(r => normalize(r.claimText) === normalize(rewrite.claimText));
    const key = normalize(rewrite.claimText);
    if (rewritten.has(key) || !rule || !rule.allowed.some(text => rewriteNormalize(text) === rewriteNormalize(rewrite.suggestedText))) wrongRewrites++;
    rewritten.add(key);
  }
  for (const rule of expected.rewrites) {
    const changes = output?.rewrites.filter(r => normalize(r.claimText) === normalize(rule.claimText)) ?? [];
    if (changes.length === 1 && rule.allowed.some(text => rewriteNormalize(text) === rewriteNormalize(changes[0].suggestedText))) rewriteCoverage++;
  }
  if (wrongRewrites || rewriteCoverage !== expected.rewrites.length) problems.push("改写错误、重复或缺失（可另附人工语义复核，不覆盖原判）。");
  return { coverage: metric(coverage, expected.claims.length), numeric: metric(numeric, expected.claims.filter(e => e.value !== null || e.officialValue !== null).length),
    caliber: metric(caliber, expected.claims.length), direction: metric(directions, expected.claims.filter(e => e.direction !== null).length),
    factual: metric(factual, expected.claims.length), groundedClaims: metric(grounded, expected.claims.length),
    citations: metric(validCitations, totalCitations), citationCoverage: metric(citationCoverage, expected.claims.filter(definitive).length),
    stop: metric(Number(stopped && expected.stop !== "none"), Number(expected.stop !== "none")), wrongRewrite: metric(wrongRewrites, output?.rewrites.length ?? 0),
    rewriteCoverage: metric(rewriteCoverage, expected.rewrites.length), success: problems.length === 0, problems };
}

export function workflowOutput(result: SourceInvestigationResult): Output {
  return { claims: result.claims.map((claim, index) => {
    const conclusion = result.conclusions[index];
    if (!conclusion) throw new Error("工作流主张与结论数量不一致。");
    return { ...claim, direction: claim.direction ?? null,
      imageExcerpt: undefined, // 下方只投影公开评分字段。
      status: conclusion.status, officialValue: conclusion.officialValue, sourceIds: conclusion.citedSourceIds,
      revisionFrom: conclusion.revisionReview?.fromSourceId ?? null };
  }).map(({ imageExcerpt: _excerpt, ...claim }) => claim),
  clarification: result.clarification ? { field: result.clarification.field, claimText: result.clarification.claimText ?? "", question: result.clarification.question } : null,
  stopReason: result.stopReason,
  rewrites: result.captionSuggestion?.changes.map(change => ({ claimText: change.claimText, suggestedText: change.suggested })) ?? [] };
}

export interface RecordRow { questionId: string; arm: Arm; repeat: number; phase: "before" | "after";
  pathId: string; state: "planned" | "ok" | "failed" | "blocked"; error: string | null;
  output: Output | null; raw: unknown; trace: unknown; visibleIds: string[]; model: string | null;
  requests: RequestRecord[]; latencyMs: number | null; judgment: Judgment; }
export interface Evaluation { mode: "offline-fixture" | "live"; manifestHash: string; repeats: number;
  rows: RecordRow[]; summary: ReturnType<typeof summarize>; }

/** 拒绝删行/重复行后再重算，避免历史失败从分母里消失。 */
export function rescoreEvaluation(bundle: Bundle, report: Evaluation): Evaluation {
  if (report.manifestHash !== bundle.manifestHash) throw new Error("记录不属于当前冻结包。");
  if (!Number.isInteger(report.repeats) || report.repeats < 1) throw new Error("记录重复次数无效。");
  const keys = new Set<string>();
  for (let repeat = 1; repeat <= report.repeats; repeat++) for (const q of bundle.questions) for (const arm of ARMS) {
    for (const phase of q.supplement ? ["before", "after"] : ["before"]) keys.add(`${q.id}/${arm}/${repeat}/${phase}`);
  }
  if (keys.size !== report.rows.length) throw new Error("计划记录缺失或增删，不能缩小分母。");
  const result = structuredClone(report);
  for (const row of result.rows) {
    const key = `${row.questionId}/${row.arm}/${row.repeat}/${row.phase}`;
    if (!keys.delete(key)) throw new Error("记录重复或不在计划中。");
    if (!["planned", "ok", "failed", "blocked"].includes(row.state)) throw new Error("记录状态无效。");
    const e = bundle.expectations.find(e => e.id === row.questionId)!;
    const expected = row.phase === "after" ? e.after! : e.before;
    row.visibleIds = row.arm === "A-direct" ? [] : row.arm === "B-full-context" ? bundle.corpus.map(d => d.id) : row.visibleIds;
    if (row.visibleIds.some(id => !bundle.corpus.some(d => d.id === id))) throw new Error("记录中的可用资料不属于冻结库。");
    row.judgment = judgeOutput(expected, row.state === "ok" ? outputSchema.parse(row.output) : null, row.visibleIds);
  }
  result.summary = summarize(result.rows);
  return result;
}
function toolRequests(driver: SourceInvestigationDriver, offset: number): RequestRecord[] {
  return (driver.requestRecords ?? []).slice(offset).map(r => {
    const usage = r.usage as { input_tokens?: number; output_tokens?: number } | null;
    return { status: r.status === "ok" ? "ok" : "failed", inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null, durationMs: r.completedAt ? Date.parse(r.completedAt) - Date.parse(r.startedAt) : 0,
      parameters: r.parameters };
  });
}

/** 固定所有计划行再调用；失败/阻塞恢复和缺失 usage 不会被过滤或写为零。 */
export async function runEvaluation(bundle: Bundle, transports: Transports, options: {
  repeats: number; mode: Evaluation["mode"]; directory?: string; checkpoint?: (evaluation: Evaluation) => Promise<void>;
}): Promise<Evaluation> {
  if (!Number.isInteger(options.repeats) || options.repeats < 1) throw new Error("重复次数须为正整数。");
  const rows: RecordRow[] = [];
  const expectation = (q: Question, phase: "before" | "after") => {
    const e = bundle.expectations.find(e => e.id === q.id);
    const result = phase === "before" ? e?.before : e?.after;
    if (!result) throw new Error(`没有期望：${q.id}/${phase}`);
    return result;
  };
  for (let repeat = 1; repeat <= options.repeats; repeat++) for (const q of bundle.questions) for (const arm of ARMS) {
    for (const phase of q.supplement ? ["before", "after"] as const : ["before"] as const) {
      rows.push({ questionId: q.id, arm, repeat, phase, pathId: `${q.id}/${repeat}/${arm}`, state: "planned", error: null,
        output: null, raw: null, trace: [], visibleIds: [], model: null, requests: [], latencyMs: null,
        judgment: judgeOutput(expectation(q, phase), null, []) });
    }
  }
  const snapshot = (): Evaluation => ({ mode: options.mode, manifestHash: bundle.manifestHash, repeats: options.repeats,
    rows: structuredClone(rows), summary: summarize(rows) });
  const save = async () => { await options.checkpoint?.(snapshot()); };
  await save();
  // 每次重复按题轮换ABC顺序，减弱时间/提供方负载顺序效应。
  for (let repeat = 1; repeat <= options.repeats; repeat++) for (const [qi, q] of bundle.questions.entries()) {
    const rotation = (qi + repeat - 1) % 3;
    const order = [...ARMS.slice(rotation), ...ARMS.slice(0, rotation)];
    for (const arm of order) {
      let session: DirectSession | null = null, driver: SourceInvestigationDriver | null = null;
      let prior: Output | null = null, priorTool: SourceInvestigationResult | null = null;
      for (const row of rows.filter(r => r.questionId === q.id && r.repeat === repeat && r.arm === arm)) {
        if (row.phase === "after" && (!prior?.clarification || prior.clarification.field !== q.supplement?.field
          || normalize(prior.clarification.claimText) !== normalize(q.supplement.claimText))) {
          row.state = "blocked"; row.error = "初查失败、未追问或追问目标错误。"; await save(); continue;
        }
        const started = Date.now(); let offset = 0;
        try {
          const input = await buildInput(bundle, q, arm, row.phase, prior, options.directory);
          if (arm === "C-tools") {
            driver ??= transports.tools(input); offset = driver.requestRecords?.length ?? 0;
            const result: SourceInvestigationResult = await runSourceInvestigation(driver, { caption: q.caption,
              ...(row.phase === "after" && priorTool ? { resume: { prior: priorTool, answer: input.answer! } } : {}) });
            priorTool = result; row.raw = result; row.trace = result.trace; row.model = result.model;
            row.visibleIds = result.hits.map(hit => hit.document.id); row.output = outputSchema.parse(workflowOutput(result));
          } else {
            session ??= transports.direct(input); offset = session.requests.length;
            const reply = await session.send(input); row.raw = reply.raw; row.model = reply.model;
            row.visibleIds = input.documents.map(d => d.id); row.output = outputSchema.parse(reply.raw);
          }
          row.state = "ok"; prior = row.output;
        } catch (error) {
          row.state = "failed"; row.error = error instanceof Error ? error.message : String(error);
          row.trace = (error as { trace?: unknown })?.trace ?? row.trace; prior = null;
        } finally {
          row.requests = arm === "C-tools" ? (driver ? toolRequests(driver, offset) : []) : (session?.requests.slice(offset) ?? []);
          row.latencyMs = Date.now() - started;
          row.judgment = judgeOutput(expectation(q, row.phase), row.output, row.visibleIds);
          await save();
        }
      }
    }
  }
  return snapshot();
}

export function summarize(rows: RecordRow[]) {
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const rates = ["coverage", "numeric", "caliber", "direction", "factual", "citations", "citationCoverage", "stop", "wrongRewrite", "rewriteCoverage", "groundedClaims"] as const;
  const arms = ARMS.map(arm => {
    const subset = rows.filter(r => r.arm === arm); const pathIds = [...new Set(subset.map(r => r.pathId))];
    const requests = subset.flatMap(r => r.requests);
    const latencies = subset.flatMap(r => r.latencyMs === null ? [] : [r.latencyMs]).sort((a,b) => a-b);
    const tokens = (key: "inputTokens" | "outputTokens") => ({ known: sum(requests.map(r => r[key] ?? 0)),
      missingRequests: requests.filter(r => r[key] === null).length, complete: requests.every(r => r[key] !== null) });
    const factualPath = (path: RecordRow[]) => path.every(r => r.state === "ok"
      && r.judgment.coverage.passed === r.judgment.coverage.total
      && ["factual", "numeric", "caliber", "direction"].every(key => {
        const m = r.judgment[key as keyof Judgment] as Metric; return m.passed === m.total;
      }));
    const pathLatencies = pathIds.flatMap(id => {
      const path = subset.filter(r => r.pathId === id);
      return path.some(r => r.latencyMs === null) ? [] : [sum(path.map(r => r.latencyMs!))];
    }).sort((a,b) => a-b);
    return { arm, attemptedStages: subset.filter(r => r.state === "ok" || r.state === "failed").length,
      failed: subset.filter(r => r.state === "failed").length, blocked: subset.filter(r => r.state === "blocked").length,
      planned: subset.filter(r => r.state === "planned").length,
      stages: metric(subset.filter(r => r.state === "ok" && r.judgment.success).length, subset.length),
      paths: metric(pathIds.filter(id => subset.filter(r => r.pathId === id).every(r => r.state === "ok" && r.judgment.success)).length, pathIds.length),
      factualPaths: metric(pathIds.filter(id => factualPath(subset.filter(r => r.pathId === id))).length, pathIds.length),
      metrics: Object.fromEntries(rates.map(key => [key, metric(sum(subset.map(r => r.judgment[key].passed)), sum(subset.map(r => r.judgment[key].total)))])),
      latencyMs: { total: sum(latencies), samples: latencies.length,
        median: latencies.length ? (latencies[Math.floor((latencies.length-1)/2)] + latencies[Math.floor(latencies.length/2)]) / 2 : null },
      pathLatencyMs: { samples: pathLatencies.length,
        median: pathLatencies.length ? (pathLatencies[Math.floor((pathLatencies.length-1)/2)] + pathLatencies[Math.floor(pathLatencies.length/2)]) / 2 : null },
      requests: requests.length, inputTokens: tokens("inputTokens"), outputTokens: tokens("outputTokens") };
  });
  const pairs = rows.filter(r => r.arm === "A-direct" && r.phase === "before").map(anchor => {
    const pathPass = (arm: Arm) => rows.filter(r => r.questionId === anchor.questionId && r.repeat === anchor.repeat && r.arm === arm)
      .every(r => r.state === "ok" && r.judgment.success);
    const success = Object.fromEntries(ARMS.map(arm => [arm, pathPass(arm)])) as Record<Arm, boolean>;
    const compare = (base: Arm) => success["C-tools"] === success[base] ? "no-gain" : success["C-tools"] ? "gain" : "regression";
    return { questionId: anchor.questionId, repeat: anchor.repeat, success, CvsA: compare("A-direct"), CvsB: compare("B-full-context") };
  });
  return { arms, pairs };
}
