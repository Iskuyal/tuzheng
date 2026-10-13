import { describe, it, expect } from "vitest";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARMS, PACK, loadBundle, buildInput, judgeOutput, runEvaluation, rescoreEvaluation, verifyPack, outputSchema, runtimeSha256 } from "../scripts/holdout-evaluation.js";
import { fixtureOutput, offlineTransports } from "../scripts/holdout-fixtures.js";

describe("独立冻结预留题与三臂", () => {
  it("源码换行转换不破坏指纹，真实内容变动仍会失败", () => {
    expect(runtimeSha256(Buffer.from("a\r\nb\r\n"))).toBe(runtimeSha256(Buffer.from("a\nb\n")));
    expect(runtimeSha256(Buffer.from("a\r\nc\r\n"))).not.toBe(runtimeSha256(Buffer.from("a\nb\n")));
  });
  it("核对12个新题、指纹与原页核对表，期望侧数值独立于生产判定器", async () => {
    const bundle = await loadBundle();
    expect(bundle.questions).toHaveLength(12);
    const checked = JSON.parse(await readFile(join(PACK, "source-checks.json"), "utf8"));
    expect(checked.retailOld.rows["2026-03"]).toBe(0.10);
    expect(checked.retailNew.rows["2026-03"]).toBe(0.12);
    expect(checked.retailNew.rows["2026-04"]).toBe(-0.23);
    expect(checked.cpiAugust.mom).toBe(0.4);
    for (const e of bundle.expectations) for (const phase of [e.before, e.after].filter(p => p !== undefined)) {
      for (const c of phase.claims) {
        if (c.sourceIds.includes("stats-retail-2026-08")) expect(c.officialValue).toBe(checked.retailNew.rows[c.period!]);
        if (c.sourceIds.includes("stats-cpi-2026-08")) expect(c.officialValue).toBe(c.basis === "month-on-month" ? checked.cpiAugust.mom : checked.cpiAugust.yoy);
      }
    }
    // 独立算式也固定检查，不调用concludeClaimSource充当oracle。
    expect(0.13 - (-0.13)).toBeCloseTo(0.26);
    expect(Math.abs(-0.32 - (-0.23))).toBeCloseTo(0.09);
    expect(0.12 - 0.10).toBeCloseTo(0.02);
  });

  it("修改题面、图片、期望、提示词、来源或添加文件都会被冻结锁拒绝", async () => {
    const directory = await mkdtemp(join(tmpdir(), "web-match-holdout-"));
    try {
      await cp(PACK, directory, { recursive: true });
      for (const file of ["questions.json", "images/h01.png", "expectations.json", "prompts/B-full-context.txt", "corpus.json"]) {
        const path = join(directory, file), bytes = await readFile(path);
        await writeFile(path, Buffer.concat([bytes, Buffer.from("changed")]));
        await expect(verifyPack(directory)).rejects.toThrow("冻结文件改变");
        await writeFile(path, bytes);
      }
      await writeFile(join(directory, "extra.txt"), "extra");
      await expect(verifyPack(directory)).rejects.toThrow("文件集合改变");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("模型输入隔离期望与转录，只有B直接收到同一完整资料集合", async () => {
    const bundle = await loadBundle(); const q = bundle.questions[0];
    for (const arm of ARMS) {
      const input = await buildInput(bundle, q, arm);
      expect(Object.keys(input).sort()).toEqual(["arm", "questionId", "phase", "prompt", "caption", "image", "mimeType", "documents", "prior", "answer"].sort());
      expect(input.image.subarray(1, 4).toString()).toBe("PNG");
      expect(input.documents).toEqual(arm === "B-full-context" ? bundle.corpus : []);
      expect(input.answer).toBeNull(); expect(input.prior).toBeNull();
      expect(input.prompt).not.toContain("retailOld"); expect(input.prompt).not.toContain("h01");
    }
  });

  it("B无搜索动作可凭合法资料完整通过；A相同事实答对与证据支持分别统计", async () => {
    const bundle = await loadBundle(); const q = bundle.questions[0], e = bundle.expectations[0].before;
    const output = fixtureOutput(await buildInput(bundle, q, "B-full-context"));
    const b = judgeOutput(e, output, bundle.corpus.map(d => d.id));
    expect(b.success).toBe(true); expect(b.citations.rate).toBe(1); expect(b.factual.rate).toBe(1);
    const a = judgeOutput(e, output, []);
    expect(a.factual.rate).toBe(1); expect(a.numeric.rate).toBe(1);
    expect(a.citations.rate).toBe(0); expect(a.success).toBe(false);
  });

  it("不适用口径、虚构/未见引用、术语当数字来源一律失败", async () => {
    const bundle = await loadBundle(); const q = bundle.questions[0], e = bundle.expectations[0].before;
    const base = fixtureOutput(await buildInput(bundle, q, "B-full-context"));
    for (const id of ["stats-cpi-2026-08", "stats-term-yoy-mom", "fake-citation"]) {
      const output = structuredClone(base); output.claims[0].sourceIds = [id];
      expect(judgeOutput(e, output, bundle.corpus.map(d => d.id)).success).toBe(false);
    }
    const wrongScope = structuredClone(base); wrongScope.claims[0].scope = "南京市";
    expect(judgeOutput(e, wrongScope, bundle.corpus.map(d => d.id)).citations.rate).toBeLessThan(1);
    expect(judgeOutput(e, base, ["stats-retail-2026-07"]).success).toBe(false);
  });

  it("来源存在并不允许遗漏第二主张、改变数值或漏方向", async () => {
    const bundle = await loadBundle(); const q = bundle.questions[1], e = bundle.expectations[1].before;
    const output = fixtureOutput(await buildInput(bundle, q, "B-full-context"));
    output.claims.splice(1, 1);
    const judged = judgeOutput(e, output, bundle.corpus.map(d => d.id));
    expect(judged.coverage.total).toBe(3); expect(judged.coverage.passed).toBe(2); expect(judged.success).toBe(false);
    const inference = bundle.questions.find(q => q.id === "h09")!;
    const directional = fixtureOutput(await buildInput(bundle, inference, "B-full-context"));
    directional.claims[0].direction = "up";
    expect(judgeOutput(bundle.expectations.find(e => e.id === "h09")!.before, directional, bundle.corpus.map(d => d.id)).direction).toMatchObject({ passed: 0, total: 1 });
  });

  it("无适用来源的恰当停止与错误改写分别记分，不能用安全停止掩盖缺改写", async () => {
    const bundle = await loadBundle(); const q = bundle.questions.find(q => q.id === "h08")!, e = bundle.expectations.find(e => e.id === q.id)!.before;
    const output = fixtureOutput(await buildInput(bundle, q, "B-full-context"));
    expect(judgeOutput(e, output, bundle.corpus.map(d => d.id)).success).toBe(true);
    output.rewrites[0].suggestedText = "南京消费强劲增长9%，政策效果显现。";
    const wrong = judgeOutput(e, output, bundle.corpus.map(d => d.id));
    expect(wrong.stop.rate).toBe(1); expect(wrong.wrongRewrite.passed).toBe(1); expect(wrong.success).toBe(false);
    output.rewrites = []; expect(judgeOutput(e, output, []).rewriteCoverage.rate).toBe(0);
    output.claims[0].status = "source-match"; output.claims[0].officialValue = -0.1;
    expect(judgeOutput(e, output, []).stop.rate).toBe(0);
    output.rewrites = [{ claimText: q.caption, suggestedText: "错误改写9%" }, { claimText: q.caption, suggestedText: "错误改写10%" }];
    expect(judgeOutput(e, output, []).wrongRewrite).toMatchObject({ passed: 2, total: 2 });
  });

  it("新版支持的配文不被旧图误改，旧版主张要记录版本替代链", async () => {
    const bundle = await loadBundle(); const q = bundle.questions.find(q => q.id === "h12")!, e = bundle.expectations.find(e => e.id === q.id)!.before;
    const output = fixtureOutput(await buildInput(bundle, q, "B-full-context"));
    expect(output.claims[0].status).toBe("source-match"); expect(output.claims[1].status).toBe("source-mismatch");
    expect(judgeOutput(e, output, bundle.corpus.map(d => d.id)).success).toBe(true);
    output.claims[1].revisionFrom = null;
    expect(judgeOutput(e, output, bundle.corpus.map(d => d.id)).success).toBe(false);
  });

  it("三臂离线真实执行编排，计划分母保留失败/阻塞/无增益/退化与未知usage", async () => {
    const bundle = await loadBundle(); let checkpoints = 0;
    const report = await runEvaluation(bundle, offlineTransports(), { repeats: 1, mode: "offline-fixture", checkpoint: async snapshot => {
      checkpoints++; expect(snapshot.rows).toHaveLength(42);
    } });
    expect(report.rows).toHaveLength(42); expect(checkpoints).toBe(43);
    expect(report.summary.arms.map(a => a.paths.total)).toEqual([12, 12, 12]);
    expect(report.summary.arms.map(a => a.stages.total)).toEqual([14, 14, 14]);
    expect(report.rows.find(r => r.questionId === "h06" && r.arm === "C-tools" && r.phase === "before")?.state).toBe("failed");
    expect(report.rows.find(r => r.questionId === "h06" && r.arm === "C-tools" && r.phase === "after")?.state).toBe("blocked");
    expect(report.summary.pairs.some(p => p.CvsB === "regression")).toBe(true);
    expect(report.summary.pairs.some(p => p.CvsB === "no-gain")).toBe(true);
    expect(report.summary.arms.every(a => a.inputTokens.missingRequests > 0 && !a.inputTokens.complete)).toBe(true);
    expect(report.rows.filter(r => r.arm === "C-tools").some(r => JSON.stringify(r.trace).includes("search_source_library"))).toBe(true);
    expect(rescoreEvaluation(bundle, report).summary).toEqual(report.summary);
    const missing = structuredClone(report); missing.rows.pop();
    expect(() => rescoreEvaluation(bundle, missing)).toThrow("分母");
    const duplicate = structuredClone(report); duplicate.rows[1] = duplicate.rows[0];
    expect(() => rescoreEvaluation(bundle, duplicate)).toThrow("重复");
  });

  it("初查不追问、追错目标或格式非法不能跳过到正确恢复；原始非法输出保留", async () => {
    const bundle = await loadBundle(); const transports = offlineTransports();
    transports.direct = () => ({ requests: [], async send(input) {
      const raw = fixtureOutput(input);
      if (input.questionId === "h05") raw.clarification = null;
      if (input.questionId === "h06") raw.clarification!.claimText = "不相干的主张";
      if (input.questionId === "h01") return { model: "fixture", raw: { malformed: true } };
      return { model: "fixture", raw };
    } });
    const report = await runEvaluation(bundle, transports, { repeats: 1, mode: "offline-fixture" });
    for (const id of ["h05", "h06"]) for (const arm of ["A-direct", "B-full-context"]) {
      expect(report.rows.find(r => r.questionId === id && r.arm === arm && r.phase === "after")?.state).toBe("blocked");
    }
    expect(report.rows.find(r => r.questionId === "h01" && r.arm === "A-direct")?.raw).toEqual({ malformed: true });
    expect(() => outputSchema.parse({ malformed: true })).toThrow();
  });
});
