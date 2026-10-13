import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { EvaluationReport, SourceAuditQuestions } from "./evaluate-source-audit.js";
import { SOURCE_LIBRARY } from "../shared/source-library.js";
import { sourceInvestigationPrompt } from "../server/source-prompt.js";
import rawExpectations from "../samples/source-audit-expectations.json" with { type: "json" };

export const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const exec = promisify(execFile);

export interface EvaluationProvenance {
  capturedAt: string;
  code: { sha: string; dirty: boolean; status: string; diffSha256: string; untracked: Record<string, string> };
  fingerprints: {
    questionsFile: string; questionsContent: string; expectationsFile: string; expectationsContent: string;
    libraryFile: string; libraryContent: string;
    images: Record<string, { pngSha256: string; svgSha256: string }>;
    documents: Record<string, string>; prompts: Record<string, string>;
  };
  runtime: { provider: string; requestedModel: string; baseUrl: string; parameters: Record<string, unknown> } | null;
}

/** 不读设置或密钥；runtime 只能传入可公开的字段，未知／未发送参数记 null。 */
export async function captureProvenance(questions: SourceAuditQuestions, runtime: EvaluationProvenance["runtime"] = null,
  root = process.cwd(), imageBuffers?: ReadonlyMap<string, Buffer>): Promise<EvaluationProvenance> {
  const git = async (...args: string[]) => (await exec("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })).stdout;
  const [sha, status, diff, untrackedPaths] = await Promise.all([
    git("rev-parse", "HEAD"), git("status", "--porcelain=v1", "--untracked-files=all"),
    git("diff", "HEAD", "--binary"), git("ls-files", "--others", "--exclude-standard", "-z"),
  ]);
  const untracked: Record<string, string> = {};
  for (const path of untrackedPaths.split("\0").filter(Boolean)) untracked[path] = sha256(await readFile(join(root, path)));
  const images: EvaluationProvenance["fingerprints"]["images"] = {};
  for (const image of Object.keys(questions.images)) {
    images[image] = { pngSha256: sha256(imageBuffers?.get(image) ?? await readFile(join(root, questions.imageDirectory, `${image}.png`))),
      svgSha256: sha256(await readFile(join(root, questions.imageDirectory, `${image}.svg`))) };
  }
  let safeRuntime = runtime;
  if (runtime) {
    const url = new URL(runtime.baseUrl);
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    safeRuntime = { ...runtime, baseUrl: url.toString() };
  }
  return {
    capturedAt: new Date().toISOString(),
    code: { sha: sha.trim(), dirty: Boolean(status.trim()), status, diffSha256: sha256(diff), untracked },
    fingerprints: {
      questionsFile: sha256(await readFile(join(root, "samples/source-audit-questions.json"))),
      questionsContent: sha256(JSON.stringify(questions)),
      expectationsFile: sha256(await readFile(join(root, "samples/source-audit-expectations.json"))),
      expectationsContent: sha256(JSON.stringify(rawExpectations)),
      libraryFile: sha256(await readFile(join(root, "shared/source-library.ts"))),
      libraryContent: sha256(JSON.stringify(SOURCE_LIBRARY)), images,
      documents: Object.fromEntries(SOURCE_LIBRARY.map((doc) => [doc.id, doc.fingerprint])),
      prompts: Object.fromEntries([true, false].map((retrieval) => [retrieval ? "retrieval" : "no-retrieval", sha256(sourceInvestigationPrompt({ retrieval }))])),
    }, runtime: safeRuntime,
  };
}

/** 独占新文件，防覆盖历史；先追加并 fsync，再原子替换快照。损坏末行不影响前面的逐次结果。 */
export async function createEvaluationWriter(paths: string[], provenance: EvaluationProvenance,
  extra: Record<string, unknown> = {}) {
  const targets = [...new Set(paths.map((path) => resolve(path)))];
  const journals: Awaited<ReturnType<typeof open>>[] = [];
  const created: string[] = [];
  const sequence = { value: 0 };
  const recordHashes = new Map<string, string>();
  try {
    // 先占用全部输出；任一路径已存在都在任何模型请求之前失败。
    for (const target of targets) {
      await mkdir(dirname(target), { recursive: true });
      const file = await open(target, "wx");
      created.push(target);
      try { await file.writeFile(JSON.stringify({ schemaVersion: 2, state: "initialized", provenance, ...extra })); await file.sync(); }
      finally { await file.close(); }
      const journal = await open(`${target}.jsonl`, "ax");
      created.push(`${target}.jsonl`);
      journals.push(journal);
    }
  } catch (error) {
    await Promise.all(journals.map((file) => file.close()));
    await Promise.all(created.map((path) => rm(path, { force: true })));
    throw error;
  }
  return {
    async save(report: EvaluationReport) {
      const snapshot = { schemaVersion: 2, ...extra, ...report, provenance };
      const updates = report.records.filter((record) => {
        const identity = record.attemptId ?? `${record.arm}/${record.questionId}/${record.run}/${record.phase}`;
        return recordHashes.get(identity) !== sha256(JSON.stringify(record));
      });
      const event = sequence.value === 0 ? { type: "snapshot", ...snapshot }
        : { type: "checkpoint", runId: report.runId, state: report.state, summary: report.summary, updates };
      const line = JSON.stringify({ sequence: ++sequence.value, savedAt: new Date().toISOString(), ...event }) + "\n";
      for (let index = 0; index < targets.length; index++) {
        await journals[index].writeFile(line);
        await journals[index].sync();
        const temp = `${targets[index]}.${randomUUID()}.tmp`;
        const file = await open(temp, "wx");
        try { await file.writeFile(JSON.stringify(snapshot, null, 2) + "\n"); await file.sync(); }
        finally { await file.close(); }
        try { await rename(temp, targets[index]); }
        finally { await rm(temp, { force: true }); }
      }
      for (const record of updates) recordHashes.set(record.attemptId ?? `${record.arm}/${record.questionId}/${record.run}/${record.phase}`, sha256(JSON.stringify(record)));
    },
    async close() { await Promise.all(journals.map((file) => file.close())); },
  };
}
