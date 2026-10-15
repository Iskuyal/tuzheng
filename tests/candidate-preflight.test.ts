import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareCandidate, verifyCandidate, verifyReview, writeNewJson } from "../scripts/candidate-preflight.js";
import { loadBundle, buildInput, sha256 } from "../scripts/holdout-evaluation.js";
import { fixtureOutput } from "../scripts/holdout-fixtures.js";
import { parseLiveArgs, runHttpEvaluation, createRunWriter } from "../scripts/run-holdout-http.js";
import { parseDemoArgs, runDemoHttp } from "../scripts/run-demo-http.js";

describe("候选冻结预检与执行停止", () => {
  it("准备及核验不发网络请求，绑定原冻结包、脏工作区及五题计划", async () => {
    const fetchImpl = vi.spyOn(globalThis, "fetch");
    try {
      const candidate = await prepareCandidate(); await verifyCandidate(candidate);
      expect(candidate.modelRequests).toBe(0); expect(candidate.plans.holdout.stages).toBe(126);
      expect(candidate.plans.demo.ids).toHaveLength(5); expect(candidate.provenance.runtime).toBeNull();
      expect(candidate.files["scripts/holdout-http.ts"]).toMatch(/^[a-f0-9]{64}$/);
      expect(fetchImpl).not.toHaveBeenCalled();
      candidate.files["scripts/holdout-http.ts"] = "0".repeat(64);
      await expect(verifyCandidate(candidate)).rejects.toThrow("候选运行文件改变");
    } finally { fetchImpl.mockRestore(); }
  });

  it("未授权、无请求上限、未知/重复参数在读配置之前拒绝", () => {
    for (const args of [[], ["--execute"], ["--execute", "--lock", "x", "--review", "r", "--max-requests", "NaN", "--output", "o"], ["--execute", "--execute"]]) expect(() => parseLiveArgs(args)).toThrow();
    expect(parseLiveArgs(["--execute", "--lock", "l", "--review", "r", "--max-requests", "1", "--output", "o"]).maxRequests).toBe(1);
  });

  it("负责人抽查必须覆盖12题并绑定候选锁，模板与重复题不能通过", async () => {
    const candidate = await prepareCandidate(); const bundle = await loadBundle();
    const ids = bundle.questions.map(q => q.id);
    const review = { candidateHash: sha256(JSON.stringify(candidate)), reviewer: "负责人测试替身", reviewedAt: "2026-10-07",
      questions: ids.map(id => ({ id, approved: true, note: "仅用于验证签字格式，非真实负责人签字" })) };
    expect(verifyReview(review, candidate, ids).questions).toHaveLength(12);
    expect(() => verifyReview({ ...review, reviewer: "" }, candidate, ids)).toThrow();
    expect(() => verifyReview({ ...review, candidateHash: "0".repeat(64) }, candidate, ids)).toThrow("不属于");
    review.questions[0].id = ids[1]; expect(() => verifyReview(review, candidate, ids)).toThrow("12题");
  });

  it("准备时提供的签字哈希在候选落盘并重新核验后仍可使用", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tuzheng-candidate-review-"));
    try {
      const candidate = await prepareCandidate();
      const ids = (await loadBundle()).questions.map(question => question.id);
      const review = { candidateHash: sha256(JSON.stringify(candidate)), reviewer: "负责人测试替身", reviewedAt: "2026-10-15",
        questions: ids.map(id => ({ id, approved: true, note: "仅验证准备与验签闭环，不是真实签字" })) };
      const path = join(directory, "candidate.json");
      await writeNewJson(path, candidate);
      const verified = await verifyCandidate(JSON.parse(await readFile(path, "utf8")));
      expect(verifyReview(review, verified, ids).questions).toHaveLength(12);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("到HTTP上限立即停止，126阶段预分配保留未执行planned，脱敏日志可独立核对", async () => {
    const directory = await mkdtemp(join(tmpdir(), "web-match-http-eval-"));
    try {
      const candidate = await prepareCandidate(); const bundle = await loadBundle(); const input = await buildInput(bundle, bundle.questions[0], "A-direct");
      const output = fixtureOutput(input); const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        model: "fixture", status: "completed", output_text: JSON.stringify(output), usage: { input_tokens: 10, output_tokens: 4 },
      })));
      const report = await runHttpEvaluation({ config: { baseUrl: "http://127.0.0.1:3001", model: "fixture", apiKey: "fake-secret" },
        provider: "openai-responses", configSource: "test-injection", candidate, maxRequests: 1, output: join(directory, "round1"), fetchImpl });
      expect(fetchImpl).toHaveBeenCalledTimes(1); expect(report.rows).toHaveLength(126);
      expect(report.rows.filter(r => r.state === "planned")).toHaveLength(125);
      expect(report.transport).toMatchObject({ kind: "injected-http-fixture", state: "stopped", amount: null });
      expect(report.comparisons.every(p => p.CvsA === "not-completed" && p.CvsB === "not-completed")).toBe(true);
      const saved = JSON.parse(await readFile(join(directory, "round1/report.json"), "utf8")); expect(saved.rows).toHaveLength(126);
      const events = (await readFile(join(directory, "round1/events.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
      expect(events.filter(e => e.type === "http")).toHaveLength(2);
      expect(JSON.stringify(events)).not.toContain("fake-secret");
      await expect(createRunWriter(join(directory, "round1"))).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("候选锁独占写入，禁止覆盖历史", async () => {
    const directory = await mkdtemp(join(tmpdir(), "web-match-preflight-"));
    try { const path = join(directory, "candidate.json"); await writeNewJson(path, { test: true }); await expect(writeNewJson(path, {})).rejects.toThrow(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("五题共享传输与原评分器，停止保留18阶段，默认参数不执行", async () => {
    expect(() => parseDemoArgs([])).toThrow("显式");
    const directory = await mkdtemp(join(tmpdir(), "web-match-demo-http-"));
    try {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ model: "fixture", content: [{ type: "text", text: "继续" }], usage: { input_tokens: 10, output_tokens: 3 } })));
      const report = await runDemoHttp({ candidate: await prepareCandidate(), config: { baseUrl: "http://127.0.0.1:3001", model: "fixture", apiKey: "fake-secret" },
        provider: "anthropic", configSource: "injected", maxRequests: 1, output: join(directory, "round1"), fetchImpl });
      expect(fetchImpl).toHaveBeenCalledTimes(1); expect(report.records).toHaveLength(18);
      expect(report.records.filter(r => r.status === "pending")).toHaveLength(17);
      expect(report.transport.state).toBe("stopped"); expect(report.mode).toBe("offline-fixture");
      const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
      expect(JSON.stringify(body.messages)).toContain("配文"); expect(JSON.stringify(body.messages)).not.toContain("expectations");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
