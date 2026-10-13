import { afterEach, describe, expect, it, vi } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyRunRecord, expectationsCatalog, questionsCatalog, readEvaluationSnapshot,
  reliabilityCounts, runPairedEvaluation, summarizeEvaluation, type EvaluationReport,
} from "../scripts/evaluate-source-audit.js";
import { captureProvenance, createEvaluationWriter } from "../scripts/source-audit-recording.js";
import { SourceInvestigationError, type SourceInvestigationDriver, type ToolLoopReply } from "../server/source-investigation.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const temp = async () => { const dir = await mkdtemp(join(tmpdir(), "web-match-eval-")); dirs.push(dir); return dir; };
const question = questionsCatalog.questions[0];
const selected = { ...questionsCatalog, questions: [question] };
const search: ToolLoopReply = { model: "response-model", usage: null, text: "先查资料", truncated: false,
  calls: [{ id: "s", name: "search_source_library", input: { metric: "全国居民消费价格", period: "2025-12", scope: "全国", terms: [] } }] };
const report: ToolLoopReply = { model: "response-model", usage: null, text: "汇总", truncated: false,
  calls: [{ id: "r", name: "report_source_finding", input: {
    claims: [{ claimText: question.caption, metric: "全国居民消费价格", scope: "全国", period: "2025-12", value: 0.8,
      basis: "year-on-year", kind: "direct", fromImage: false, imageExcerpt: null }],
    citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
    noApplicableSourceReason: null, unresolvedItems: [], omittedClaims: [],
  } }] };
const driver = (): SourceInvestigationDriver => ({ model: "configured-model",
  start: async () => search, continue: async () => report, finalize: async () => report,
  resume: async () => { throw new Error("不应恢复"); },
});

describe("评测分母与完整路径", () => {
  it("q18 提了正确追问但初查漏掉配文主张时，不把图上主张当补证依据或记成回答一致", async () => {
    const q18 = questionsCatalog.questions.find((q) => q.id === "q18-clarify-basis-resume")!;
    const imageClaim = { claimText: q18.caption, metric: "全国居民消费价格", scope: "全国", period: "2025-12", value: 0.8,
      basis: "year-on-year", kind: "direct", fromImage: true, imageExcerpt: q18.caption };
    const summaryReply = (after: boolean): ToolLoopReply => ({ ...report, calls: [{ id: "r", name: "report_source_finding", input: {
      claims: after ? [{ ...imageClaim, fromImage: false, imageExcerpt: null }, imageClaim] : [imageClaim],
      citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
      noApplicableSourceReason: null, unresolvedItems: [], omittedClaims: [],
    } }] });
    const ask: ToolLoopReply = { ...search, calls: [{ id: "c", name: "request_clarification", input: {
      question: "这句是同比还是环比？", purpose: "确认这条配文口径。", field: "basis", claimText: q18.caption,
    } }] };
    let turns = 0;
    const replayDriver: SourceInvestigationDriver = { model: "stub", start: async () => search,
      continue: async () => ++turns === 1 ? ask : summaryReply(false),
      resume: async () => summaryReply(true), finalize: async () => summaryReply(true),
    };
    const result = await runPairedEvaluation({ ...selected, questions: [q18] }, expectationsCatalog, {
      runs: 1, arms: ["retrieval"], driverFactory: () => replayDriver,
    });
    expect(result.records[0].judgment.problems.map((p) => p.kind)).toContain("no-matching-claim");
    expect(result.records[0].clarification).toMatchObject({ field: "basis", claimText: q18.caption });
    expect(result.records[1].supplement).toMatchObject({ applied: false });
    expect(result.records[1].supplement?.note).toContain("没有匹配到");
    expect(result.records[1].judgment.problems.map((p) => p.kind)).toContain("missing-supplement-application");
    expect(result.summary.arms[0].fullPathPass).toMatchObject({ passed: 0, total: 1 });
    expect(result.records[1].parentAttemptId).toBe(result.records[0].attemptId);
  });

  it("成功、上游失败与缺追问分别计数，失败不能让门槛显示 100%", () => {
    const before = { ...emptyRunRecord({ questionId: question.id, arm: "retrieval", run: 1, phase: "before" }),
      status: "ok" as const, judgment: { ok: true, problems: [] } };
    const failed = { ...before, run: 2, status: "failed" as const, failureKind: "timeout", judgment: { ok: false, problems: [] } };
    const summary = summarizeEvaluation([before, failed], expectationsCatalog);
    expect(summary.arms[0]).toMatchObject({
      stagePass: { passed: 1, total: 2, rate: 0.5 }, fullPathPass: { passed: 1, total: 2, rate: 0.5 },
      validRunPass: { passed: 1, total: 1, rate: 1 }, allAttemptSuccess: { passed: 1, total: 2, rate: 0.5 },
    });
    expect(summary.gates[0].passed).toBe(false);
  });

  it("q18 只过初查／只过恢复均不算完整路径，历史缺失恢复仍计阶段分母", () => {
    const before = { ...emptyRunRecord({ questionId: "q18-clarify-basis-resume", arm: "retrieval", run: 1, phase: "before" }),
      status: "ok" as const, judgment: { ok: true, problems: [] } };
    const after = { ...before, phase: "after" as const, judgment: { ok: false, problems: [] } };
    expect(reliabilityCounts([before], expectationsCatalog)).toMatchObject({
      blockedStages: 1, stagePass: { passed: 1, total: 2 }, fullPathPass: { passed: 0, total: 1 },
    });
    expect(reliabilityCounts([before, after], expectationsCatalog).fullPathPass.passed).toBe(0);
    expect(reliabilityCounts([{ ...before, judgment: { ok: false, problems: [] } },
      { ...after, judgment: { ok: true, problems: [] } }], expectationsCatalog).fullPathPass.passed).toBe(0);
  });
});

describe("逐次落盘与复核指纹", () => {
  it("记录实际 SHA、工作区与全部输入指纹，端点认证信息不留档", async () => {
    const root = await temp();
    for (const dir of ["samples", "shared", questionsCatalog.imageDirectory]) await mkdir(join(root, dir), { recursive: true });
    for (const path of ["samples/source-audit-questions.json", "samples/source-audit-expectations.json", "shared/source-library.ts",
      ...Object.keys(questionsCatalog.images).flatMap((image) => ["png", "svg"].map((ext) => `${questionsCatalog.imageDirectory}/${image}.${ext}`))]) {
      await copyFile(path, join(root, path));
    }
    const git = promisify(execFile);
    await git("git", ["init"], { cwd: root });
    await git("git", ["add", "."], { cwd: root });
    await git("git", ["-c", "user.name=离线测试", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "测试输入"], { cwd: root });
    const clean = await captureProvenance(questionsCatalog, null, root);
    expect(clean.code.dirty).toBe(false);
    await writeFile(join(root, questionsCatalog.imageDirectory, `${question.image}.png`), "图片被改变");
    await writeFile(join(root, "new-note.txt"), "未跟踪文件");
    const provenance = await captureProvenance(questionsCatalog, {
      provider: "stub", requestedModel: "stub", baseUrl: "https://user:secret@example.com/v1?key=secret#secret", parameters: { temperature: null },
    }, root);
    expect(provenance.code.sha).toMatch(/^[a-f0-9]{40}$/);
    expect(provenance.code.dirty).toBe(true);
    expect(provenance.code.sha).toBe(clean.code.sha);
    expect(provenance.code.diffSha256).not.toBe(clean.code.diffSha256);
    expect(provenance.code.untracked["new-note.txt"]).toHaveLength(64);
    expect(provenance.fingerprints.images[question.image].pngSha256).not.toBe(clean.fingerprints.images[question.image].pngSha256);
    expect(provenance.fingerprints.images[question.image].pngSha256).toHaveLength(64);
    expect(provenance.fingerprints.expectationsFile).toHaveLength(64);
    expect(Object.keys(provenance.fingerprints.documents)).toHaveLength(5);
    expect(JSON.stringify(provenance)).not.toContain("secret");
  });

  it("开跑前保存计划，每次结束先保存再走下一题；中断保留结果及未执行分母", async () => {
    const dir = await temp(); const path = join(dir, "eval.json");
    const writer = await createEvaluationWriter([path], await captureProvenance(questionsCatalog));
    const factory = vi.fn(driver);
    let completed = 0;
    try {
      await expect(runPairedEvaluation(selected, expectationsCatalog, {
        arms: ["retrieval"], runs: 2, driverFactory: factory,
        onCheckpoint: async (snapshot) => {
          await writer.save(snapshot);
          if (snapshot.records.some((r) => r.status === "ok")) { completed++; throw new Error("模拟中断"); }
        },
      })).rejects.toThrow("模拟中断");
    } finally { await writer.close(); }
    expect(factory).toHaveBeenCalledTimes(1);
    expect(completed).toBe(1);
    const snapshot = readEvaluationSnapshot(await readFile(path, "utf8"));
    expect(snapshot.state).toBe("running");
    expect(snapshot.records.map((r) => r.status)).toEqual(["ok", "pending"]);
    expect(snapshot.records[0]).toMatchObject({ model: "response-model", parentAttemptId: null });
    expect(snapshot.records[0].trace?.length).toBeGreaterThan(0);
    expect(snapshot.summary.arms[0].fullPathPass.total).toBe(2);
    const journal = await readFile(`${path}.jsonl`, "utf8");
    expect(readEvaluationSnapshot(journal + '{"incomplete":', true).records).toEqual(snapshot.records);
    expect(() => readEvaluationSnapshot('{"broken":\n' + journal, true)).toThrow();
  });

  it("已有原始文件拒绝覆盖，也不留下半创建的另一路输出", async () => {
    const dir = await temp(); const history = join(dir, "history.json"); const fresh = join(dir, "fresh.json");
    await writeFile(history, "历史原始数据");
    await expect(createEvaluationWriter([fresh, history], await captureProvenance(questionsCatalog))).rejects.toThrow();
    expect(await readFile(history, "utf8")).toBe("历史原始数据");
    await expect(readFile(fresh)).rejects.toThrow();
  });

  it("检索后上游失败仍保存工具轨迹、失败结果与安全错误分类", async () => {
    const failing = driver();
    failing.continue = async () => { throw new SourceInvestigationError("timeout", { cause: new Error("Authorization secret") }); };
    const snapshots: EvaluationReport[] = [];
    const result = await runPairedEvaluation(selected, expectationsCatalog, {
      arms: ["retrieval"], runs: 1, driverFactory: () => failing,
      onCheckpoint: async (snapshot) => { snapshots.push(snapshot); },
    });
    expect(result.records[0]).toMatchObject({ status: "failed", failureKind: "timeout", toolSequence: ["search_source_library:ok"] });
    expect(JSON.stringify(result)).not.toContain("Authorization secret");
    expect(snapshots[0].records[0].status).toBe("pending");
    expect(snapshots.at(-1)?.state).toBe("completed");
  });
});
