import { describe, expect, it } from "vitest";
import { createStudyTemplate, summarizeStudy } from "../scripts/user-study.js";

describe("匿名用户任务记录与统计", () => {
  it("空模板保留64条计划、零实测、时间未知且没有收益结论", () => {
    const report = summarizeStudy(createStudyTemplate());
    expect(report.total).toMatchObject({ planned: 64, pending: 64, attempted: 0, medianSeconds: null });
    expect(report.participantsObserved).toBe(0); expect(report.pairs.every(p => !p.measured)).toBe(true);
    expect(report.conclusion).toContain("尚无真实用户");
  });
  it("真实逐人失败保留在分母、配对时间包括失败、证据卡分组不冒充产品", () => {
    const study = createStudyTemplate(); study.participants[0].consent = true; study.participants[0].eligible = true;
    const manual = study.records.find(r => r.participant === "P01" && r.task === "T1" && r.condition === "manual")!;
    const card = study.records.find(r => r.participant === "P01" && r.task === "T1" && r.condition === "product")!;
    Object.assign(manual, { state: "failed", execution: "manual", success: false, seconds: 90, hints: 1, response: "测试替身错答", evidence: "只用于测试", failureReason: "误判" });
    Object.assign(card, { state: "completed", execution: "evidence-card", success: true, seconds: 60, hints: 0, response: "测试替身回答", evidence: "只用于测试" });
    const report = summarizeStudy(study);
    expect(report.total).toMatchObject({ attempted: 2, failed: 1, success: 1, medianSeconds: 75 });
    expect(report.executionGroups["live-product"].attempted).toBe(0);
    expect(report.pairs[0]).toMatchObject({ measured: true, productMinusManualSeconds: -30, execution: "evidence-card" });
  });
  it("拒绝删行、重复行、未同意参与者、缺计时和把待测写成实测", () => {
    const study = createStudyTemplate();
    expect(() => summarizeStudy({ ...study, records: study.records.slice(1) })).toThrow();
    study.records[0] = study.records[1]; expect(() => summarizeStudy(study)).toThrow("重复");
    const invalid = createStudyTemplate(); invalid.records[0].seconds = 0;
    expect(() => summarizeStudy(invalid)).toThrow("待测");
    Object.assign(invalid.records[0], { state: "completed", execution: "manual", success: true, seconds: 10, hints: 0, response: "回答", evidence: "观察" });
    expect(() => summarizeStudy(invalid)).toThrow("同意");
    invalid.participants[0].consent = true; invalid.participants[0].eligible = true; invalid.records[0].seconds = null;
    expect(() => summarizeStudy(invalid)).toThrow("计时");
  });
});
