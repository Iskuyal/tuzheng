import { describe, expect, it } from "vitest";
import catalog from "../samples/fixed-evaluation.json" with { type: "json" };
import imageChecksums from "../samples/image-checksums.json" with { type: "json" };
import { runFixedEvaluation } from "../scripts/evaluate-samples.js";

describe("固定样例评测入口", () => {
  it("覆盖十八张自制图片和五组跨图配对，正常结果全通过", async () => {
    const report = await runFixedEvaluation(catalog);
    expect(catalog.cases).toHaveLength(18);
    expect(report.checked).toBe(23);
    expect(report.failed).toBe(0);
    expect(report.lines).toHaveLength(23);
  });

  it("独立预期被故意改错时会明确报失败", async () => {
    const wrong = structuredClone(catalog);
    wrong.cases[0].claims[0].status = "consistent";
    const report = await runFixedEvaluation(wrong);
    expect(report.failed).toBeGreaterThan(0);
    expect(report.lines.find((line) => line.id === "conflict")?.ok).toBe(false);
    expect(report.lines.find((line) => line.id === "conflict")?.problems.join(" ")).toContain("status");
  });

  it("图上可见文字或固定 PNG 指纹漂移时会报失败", async () => {
    const wrongText = structuredClone(catalog);
    wrongText.cases[0].imageLabels[0] = "图上根本不存在的标题";
    const textReport = await runFixedEvaluation(wrongText);
    expect(textReport.lines.find((line) => line.id === "conflict")?.problems.join(" ")).toContain("图上可见文字缺少");

    const wrongImages = structuredClone(imageChecksums.images);
    wrongImages.conflict.pngSha256 = "0".repeat(64);
    const imageReport = await runFixedEvaluation(catalog, wrongImages);
    expect(imageReport.lines.find((line) => line.id === "conflict")?.problems.join(" ")).toContain("PNG SHA256");
  });

  it("跨图口径不合被误写成确定结论时会报失败", async () => {
    const wrong = structuredClone(catalog);
    wrong.crossPairs[2].status = "consistent";
    const report = await runFixedEvaluation(wrong);
    expect(report.lines.find((line) => line.id === "cross-scope-mismatch")?.problems.join(" ")).toContain("status");
  });
});
