import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import catalog from "../samples/fixed-evaluation.json" with { type: "json" };
import imageChecksums from "../samples/image-checksums.json" with { type: "json" };
import { createApp } from "../server/app.js";
import { assessAxisRisk } from "../shared/axis-risk.js";
import { toAuditObservation, type AuditResult, type ChartObservation } from "../shared/audit.js";
import { claimScopeView, compareClaimScopes, compareCrossGrowth } from "../shared/cross-image.js";
import { sampleCases, type SampleCase } from "../shared/samples.js";

export interface FixedEvaluationCatalog {
  licenseDefinitions: Record<string, string>;
  cases: Array<{
    id: string;
    license: string;
    axisRisk: string | null;
    axisRange: Array<number | string | null> | null;
    axisSummaryIncludes?: string;
    imageLabels: string[];
    claims: Array<{
      id: string;
      title: string;
      older: Array<string | number | null>;
      newer: Array<string | number | null>;
      status: string;
      growthPercent: number | null;
      formula: string | null;
      evidence: string;
      correctedNewerValue?: number;
      reasonIncludes?: string;
    }>;
  }>;
  crossPairs: Array<{
    id: string;
    current: string;
    reference: string;
    status: string;
    differencePoints: number | null;
    blockers: string[];
    reasonIncludes?: string;
  }>;
}

export type ImageChecksums = Record<string, { svgSha256: string; pngSha256: string }>;

export interface EvaluationLine {
  id: string;
  ok: boolean;
  problems: string[];
}

export interface EvaluationReport {
  checked: number;
  failed: number;
  lines: EvaluationLine[];
}

function compareResult(result: AuditResult, expected: FixedEvaluationCatalog["cases"][number]["claims"][number], problems: string[]): void {
  if (result.status !== expected.status) problems.push(`${expected.id} status: ${result.status} != ${expected.status}`);
  if (result.calculatedGrowthPercent !== expected.growthPercent) {
    problems.push(`${expected.id} growth: ${result.calculatedGrowthPercent} != ${expected.growthPercent}`);
  }
  if (result.formula !== expected.formula) problems.push(`${expected.id} formula: ${result.formula} != ${expected.formula}`);
  if (expected.reasonIncludes && !result.reasons.join(" ").includes(expected.reasonIncludes)) {
    problems.push(`${expected.id} reason missing: ${expected.reasonIncludes}`);
  }
}

/** 只走预置样例 API 与确定性规则；不请求视觉模型或现实来源。 */
export async function runFixedEvaluation(
  suite: FixedEvaluationCatalog,
  expectedImages: ImageChecksums = imageChecksums.images,
): Promise<EvaluationReport> {
  const app = createApp({ visionAdapter: null });
  const sampleById = new Map<string, SampleCase>(sampleCases.map((sample) => [sample.id, sample]));
  const loaded = new Map<string, ChartObservation>();
  const lines: EvaluationLine[] = [];

  if (suite.cases.length < 18 || suite.cases.length !== sampleCases.length) {
    lines.push({ id: "catalog", ok: false, problems: [`样例清单应完整覆盖至少 18 张图片：${suite.cases.length}/${sampleCases.length}`] });
  }
  const listedIds = new Set(suite.cases.map((entry) => entry.id));
  for (const sample of sampleCases) {
    if (!listedIds.has(sample.id)) lines.push({ id: `catalog:${sample.id}`, ok: false, problems: ["缺少独立预期"] });
  }

  for (const expected of suite.cases) {
    const problems: string[] = [];
    const sample = sampleById.get(expected.id);
    if (!sample) {
      lines.push({ id: expected.id, ok: false, problems: ["找不到预置样例"] });
      continue;
    }
    if (!suite.licenseDefinitions[expected.license]) problems.push("缺少使用许可说明");
    const svgPath = join(process.cwd(), "web", "public", sample.imageUrl.slice(1));
    const pngPath = svgPath.replace(/\.svg$/, ".png");
    let svg = "";
    try {
      const svgBytes = await readFile(svgPath);
      svg = svgBytes.toString("utf8");
      const png = await readFile(pngPath);
      if (png.readUInt32BE(16) !== 960 || png.readUInt32BE(20) !== 640) problems.push("PNG 尺寸不是 960×640");
      const frozen = expectedImages[expected.id];
      if (!frozen) {
        problems.push("缺少固定图片指纹");
      } else {
        // Git 在 Windows 检出时可能改行尾；只归一化 SVG 的行尾，PNG 保持逐字节校验。
        if (createHash("sha256").update(svg.replace(/\r\n/g, "\n"), "utf8").digest("hex") !== frozen.svgSha256) {
          problems.push("SVG SHA256 与固定图片不符");
        }
        if (createHash("sha256").update(png).digest("hex") !== frozen.pngSha256) problems.push("PNG SHA256 与固定图片不符");
      }
      const visibleText = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
        .map((match) => match[1].replace(/<[^>]*>/g, ""))
        .join(" ");
      for (const label of expected.imageLabels) {
        if (!visibleText.includes(label)) problems.push(`图上可见文字缺少 ${label}`);
      }
    } catch {
      problems.push("缺少同内容的 SVG 或 PNG 图片");
    }

    const response = await request(app).post("/api/audit/sample").send({ id: expected.id });
    if (response.status !== 200) {
      lines.push({ id: expected.id, ok: false, problems: [...problems, `样例 API 返回 ${response.status}`] });
      continue;
    }
    const chart = response.body.observation as ChartObservation;
    loaded.set(expected.id, chart);
    if (chart.source !== "preset-example") problems.push("来源未标为预置示例");
    if (chart.claims.length !== expected.claims.length) problems.push("主张数量不符");
    const actualAxisRange = chart.axis ? [chart.axis.min, chart.axis.max, chart.axis.unit] : null;
    if (JSON.stringify(actualAxisRange) !== JSON.stringify(expected.axisRange)) problems.push("轴读数与独立预期不符");

    for (const claimExpected of expected.claims) {
      const claim = chart.claims.find(({ id }) => id === claimExpected.id);
      if (!claim) {
        problems.push(`找不到主张 ${claimExpected.id}`);
        continue;
      }
      if (claim.claimText !== claimExpected.title || !svg.includes(claimExpected.title)) {
        problems.push(`${claim.id} 标题与图片或独立预期不符`);
      }
      if (JSON.stringify([claim.older.period, claim.older.value, claim.older.unit]) !== JSON.stringify(claimExpected.older)) {
        problems.push(`${claim.id} 较早观察与独立预期不符`);
      }
      if (JSON.stringify([claim.newer.period, claim.newer.value, claim.newer.unit]) !== JSON.stringify(claimExpected.newer)) {
        problems.push(`${claim.id} 较新观察与独立预期不符`);
      }
      if (!claim.older.evidenceText?.trim()) problems.push(`${claim.id} 较早图内证据缺失`);
      const newerEvidence = Boolean(claim.newer.evidenceText?.trim());
      if (newerEvidence !== (claimExpected.evidence === "both")) {
        problems.push(`${claim.id} 较新图内证据状态不符`);
      }
      const audit = toAuditObservation(chart, claim);
      audit.confirmed = true;
      if (claimExpected.correctedNewerValue !== undefined) {
        audit.newer = { ...audit.newer, value: claimExpected.correctedNewerValue, valueSource: "user" };
      }
      const checked = await request(app).post("/api/audit/check").send(audit);
      if (checked.status !== 200) problems.push(`${claim.id} 计算 API 返回 ${checked.status}`);
      else compareResult(checked.body.result as AuditResult, claimExpected, problems);
    }

    const firstClaim = chart.claims[0];
    if (expected.axisRisk !== null) {
      if (!chart.axis || firstClaim?.older.value === null || firstClaim?.newer.value === null || !firstClaim) {
        problems.push("无法执行预期的纵轴评测");
      } else {
        const axis = assessAxisRisk(chart.axis, [firstClaim.older.value, firstClaim.newer.value]);
        if (axis.level !== expected.axisRisk) problems.push(`axisRisk: ${axis.level} != ${expected.axisRisk}`);
        if (expected.axisSummaryIncludes && !axis.summary.includes(expected.axisSummaryIncludes)) {
          problems.push(`纵轴原因未包含 ${expected.axisSummaryIncludes}`);
        }
      }
    } else if (chart.axis && firstClaim?.older.value !== null && firstClaim?.newer.value !== null) {
      problems.push("未预期的纵轴判断仍可产生");
    }
    lines.push({ id: expected.id, ok: problems.length === 0, problems });
  }

  for (const expected of suite.crossPairs) {
    const problems: string[] = [];
    const current = loaded.get(expected.current);
    const reference = loaded.get(expected.reference);
    const leftClaim = current?.claims[0];
    const rightClaim = reference?.claims[0];
    const left = current && leftClaim ? claimScopeView(current, leftClaim.id) : null;
    const right = reference && rightClaim ? claimScopeView(reference, rightClaim.id) : null;
    if (!left || !right || !current || !reference || !leftClaim || !rightClaim) {
      lines.push({ id: expected.id, ok: false, problems: ["缺少跨图观察或主张"] });
      continue;
    }
    const scope = compareClaimScopes({ ...left, confirmed: true }, { ...right, confirmed: true }, []);
    if (scope.blockers.join(",") !== expected.blockers.join(",")) {
      problems.push(`blockers: ${scope.blockers.join(",")} != ${expected.blockers.join(",")}`);
    }
    const verdict = scope.ready
      ? compareCrossGrowth(
        { ...toAuditObservation(current, leftClaim), confirmed: true },
        { ...toAuditObservation(reference, rightClaim), confirmed: true },
      )
      : null;
    const actualStatus = verdict?.status ?? "needs-confirmation";
    if (actualStatus !== expected.status) problems.push(`status: ${actualStatus} != ${expected.status}`);
    if (!scope.ready) {
      if (expected.differencePoints !== null) problems.push("口径不合时仍预期数值差");
      const reasons = scope.elements.filter((element) => scope.blockers.includes(element.key)).map((element) => element.label).join("、");
      if (expected.reasonIncludes && !reasons.includes(expected.reasonIncludes)) problems.push(`待核对原因缺少 ${expected.reasonIncludes}`);
    } else if (verdict) {
      if (verdict.differencePoints !== expected.differencePoints) {
        problems.push(`difference: ${verdict.differencePoints} != ${expected.differencePoints}`);
      }
      if (!leftClaim.older.evidenceText || !leftClaim.newer.evidenceText
        || !rightClaim.older.evidenceText || !rightClaim.newer.evidenceText) {
        problems.push("跨图两侧证据不完整");
      }
    }
    lines.push({ id: expected.id, ok: problems.length === 0, problems });
  }

  return { checked: lines.length, failed: lines.filter((line) => !line.ok).length, lines };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const report = await runFixedEvaluation(catalog);
  for (const line of report.lines) {
    console.log(`${line.ok ? "PASS" : "FAIL"} ${line.id}${line.ok ? "" : `：${line.problems.join("；")}`}`);
  }
  console.log(`固定评测：${report.checked - report.failed}/${report.checked} 通过。`);
  if (report.failed) process.exitCode = 1;
}
