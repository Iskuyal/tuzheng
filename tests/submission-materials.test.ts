import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifySubmissionMaterials } from "../scripts/submission-materials.js";

async function withMaterials(action: (root: string, registry: ReturnType<typeof fixtureRegistry>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "tuzheng-materials-test-"));
  const registry = fixtureRegistry();
  const bytes = Buffer.from("offline media hash fixture; not a decoded video");
  const proof = { path: registry.formalVideo.path, seconds: 398, resolution: [1920, 1080], audioTracks: 0,
    bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), fullDecode: "passed" };
  try {
    for (const path of registry.files) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, path === registry.technicalReport.path ? "%PDF-fixture" : "offline fixture");
    }
    await writeFile(join(root, registry.formalVideo.path), bytes);
    await writeFile(join(root, registry.formalVideo.verification), JSON.stringify(proof));
    await writeFile(join(root, "docs/submission/materials.json"), JSON.stringify(registry));
    await action(root, registry);
  } finally { await rm(root, { recursive: true, force: true }); }
}

function fixtureRegistry() {
  return { schemaVersion: 1, technicalReport: { path: "docs/report.pdf", source: "docs/report.html" },
    formalVideo: { path: "docs/video.mp4", verification: "docs/proof.json", voiceover: "docs/voiceover.md",
      chapters: "docs/chapters.srt", status: "picture-complete-voiceover-pending" },
    files: ["docs/submission/materials.json", "docs/report.pdf", "docs/report.html", "docs/video.mp4", "docs/proof.json", "docs/voiceover.md", "docs/chapters.srt"] };
}

describe("提交材料交接", () => {
  it("工作区预检收录用户提供的有声视频，区分用户确认与人工签字", () => {
    const reply = spawnSync(process.execPath, ["--import", "tsx", "docs/submission/closeout/prepare-package.mjs", "--check-materials", "--json"], {
      cwd: resolve(import.meta.dirname, ".."), encoding: "utf8", windowsHide: true,
    });
    expect(reply.status, reply.stderr).toBe(0);
    const result = JSON.parse(reply.stdout);
    const paths = result.files.map((file: { path: string }) => file.path);
    expect(paths).toContain("docs/submission/tuzheng-competition-demo-2026-10-28.mp4");
    expect(paths).toContain("docs/submission/demo-2026-10-18/voiceover.md");
    expect(paths).toContain("docs/submission/demo-2026-10-18/chapters.srt");
    expect(result.acceptance.formalVideo).toBe("approved-by-user");
    expect(result.formalVideo.audioTracks).toBe(1);
    expect(result.acceptance.secondWindows).toBe("confirmed-by-user");
    expect(result.acceptance.ownerReview).toBe("pending");
    expect(result.acceptance.contestSubmission).toBe("pending");
    expect(result.modelRequests).toBe(0);
  });

  it("视频字节被替换后拒绝与旧验证记录混用", async () => withMaterials(async (root, registry) => {
    await writeFile(join(root, registry.formalVideo.path), "changed after recording");
    await expect(verifySubmissionMaterials(root)).rejects.toThrow("SHA-256 不一致");
  }));

  it("配音稿遗漏时不生成就绪交付清单", async () => withMaterials(async (root, registry) => {
    await rm(join(root, registry.formalVideo.voiceover));
    await expect(verifySubmissionMaterials(root)).rejects.toThrow("交付材料不存在");
  }));

  it("有声视频按音轨与字节验收，仍不代签最终听审", async () => withMaterials(async (root, registry) => {
    registry.formalVideo.status = "audio-provided-final-review-pending";
    const proofPath = join(root, registry.formalVideo.verification);
    const proof = JSON.parse(await readFile(proofPath, "utf8"));
    proof.audioTracks = 1;
    await writeFile(proofPath, JSON.stringify(proof));
    await writeFile(join(root, "docs/submission/materials.json"), JSON.stringify(registry));
    const result = await verifySubmissionMaterials(root);
    expect(result.acceptance.formalVideo).toBe("audio-provided-final-review-pending");
    expect(result.acceptance.ownerReview).toBe("pending");
  }));

  it("无音轨证明不能把无声母版升级为有声视频", async () => withMaterials(async (root, registry) => {
    registry.formalVideo.status = "audio-provided-final-review-pending";
    await writeFile(join(root, "docs/submission/materials.json"), JSON.stringify(registry));
    await expect(verifySubmissionMaterials(root)).rejects.toThrow("音轨记录");
  }));

  it("最终视频确认必须绑定当前文件哈希，不能沿用另一个文件的确认", async () => withMaterials(async (root, registry) => {
    registry.formalVideo.status = "approved-by-user";
    const proofPath = join(root, registry.formalVideo.verification);
    const proof = JSON.parse(await readFile(proofPath, "utf8"));
    proof.audioTracks = 1;
    await writeFile(proofPath, JSON.stringify(proof));
    await writeFile(join(root, "docs/submission/materials.json"), JSON.stringify(registry));
    await expect(verifySubmissionMaterials(root)).rejects.toThrow("缺少用户确认记录");
    const recordPath = "docs/delivery-update.json";
    Object.assign(registry, { deliveryUpdateRecord: recordPath });
    registry.files.push(recordPath);
    const update = { schemaVersion: 1, kind: "user-delivery-update",
      formalVideo: { status: "approved-by-user", sha256: "0".repeat(64), confirmationMethod: "user-attestation",
        confirmationStatement: "已完整检查，可作为提交版", confirmedAt: "2026-10-28" },
      secondWindows: { status: "confirmed-by-user", confirmationMethod: "user-attestation",
        statement: "另一位开发者已验收", confirmedAt: "2026-10-28", operator: null, originalReportProvided: false } };
    await writeFile(join(root, recordPath), JSON.stringify(update));
    await writeFile(join(root, "docs/submission/materials.json"), JSON.stringify(registry));
    await expect(verifySubmissionMaterials(root)).rejects.toThrow("不属于当前视频字节");
    update.formalVideo.sha256 = proof.sha256;
    await writeFile(join(root, recordPath), JSON.stringify(update));
    const result = await verifySubmissionMaterials(root);
    expect(result.acceptance.formalVideo).toBe("approved-by-user");
    expect(result.acceptance.ownerReview).toBe("pending");
    expect(result.deliveryUpdateEvidence?.formalVideoScope).toContain("exact video hash");
  }));

  it("用户确认第二环境进入交付清单，缺少报告的范围限制随包保留", async () => withMaterials(async (root, registry) => {
    const recordPath = "docs/delivery-update.json";
    Object.assign(registry, { deliveryUpdateRecord: recordPath });
    registry.files.push(recordPath);
    await writeFile(join(root, recordPath), JSON.stringify({ schemaVersion: 1, kind: "user-delivery-update",
      secondWindows: { status: "confirmed-by-user", confirmationMethod: "user-attestation",
        statement: "另一位开发者已验收", confirmedAt: "2026-10-28", operator: null, originalReportProvided: false },
      ownerReview: { status: "passed" } }));
    await writeFile(join(root, "docs/submission/materials.json"), JSON.stringify(registry));
    const result = await verifySubmissionMaterials(root);
    expect(result.acceptance.secondWindows).toBe("confirmed-by-user");
    expect(result.deliveryUpdateEvidence?.secondWindowsScope).toContain("original machine report not provided");
    expect(result.acceptance.ownerReview).toBe("pending");
    registry.files = registry.files.filter(path => path !== recordPath);
    await writeFile(join(root, "docs/submission/materials.json"), JSON.stringify(registry));
    await expect(verifySubmissionMaterials(root)).rejects.toThrow("清单重复或遗漏");
  }));

  it("清单中的仓库外路径在读取前被拒绝", async () => withMaterials(async (root, registry) => {
    registry.files.push("../outside.txt");
    await writeFile(join(root, "docs/submission/materials.json"), JSON.stringify(registry));
    await expect(verifySubmissionMaterials(root)).rejects.toThrow("越出仓库");
  }));

  it("材料齐备也保持配音、人工签字与最终提交为待办", async () => withMaterials(async root => {
    const result = await verifySubmissionMaterials(root);
    expect(result.acceptance.formalVideo).toBe("picture-complete-voiceover-pending");
    expect(result.acceptance.ownerReview).toBe("pending");
    expect(result.acceptance.contestSubmission).toBe("pending");
  }));

  it("已提供的团队信息与匿名访问证据进入交付包，同时保留其余人工门槛", async () => withMaterials(async (root, registry) => {
    const recordPath = "docs/non-video-closeout.json";
    const proofPath = "docs/anonymous-access.json";
    Object.assign(registry, { acceptanceRecord: recordPath });
    registry.files.push(recordPath, proofPath);
    await writeFile(join(root, recordPath), JSON.stringify({ schemaVersion: 1, kind: "non-video-closeout-record",
      team: { status: "information-provided" }, reviewerAccess: { status: "public-anonymous-verified", evidence: proofPath },
      ownerReview: { status: "passed" } }));
    await writeFile(join(root, proofPath), JSON.stringify({ kind: "anonymous-reviewer-access-check", state: "passed",
      sourceSha: "1234567890123456789012345678901234567890", checks: [{ status: 200, passed: true }] }));
    await writeFile(join(root, "docs/submission/materials.json"), JSON.stringify(registry));
    const result = await verifySubmissionMaterials(root);
    expect(result.acceptance.teamInformation).toBe("information-provided");
    expect(result.acceptance.reviewerAccess).toBe("public-anonymous-verified");
    expect(result.acceptance.ownerReview).toBe("pending");
    expect(result.acceptance.secondWindows).toBe("pending");
    expect(result.acceptance.unknownHttp13).toBe("pending");
    expect(result.acceptance.contestSubmission).toBe("pending");
  }));

  it("匿名访问有失败记录时不能把评审访问标为已验证", async () => withMaterials(async (root, registry) => {
    const recordPath = "docs/non-video-closeout.json";
    const proofPath = "docs/anonymous-access.json";
    Object.assign(registry, { acceptanceRecord: recordPath });
    registry.files.push(recordPath, proofPath);
    await writeFile(join(root, recordPath), JSON.stringify({ schemaVersion: 1, kind: "non-video-closeout-record",
      team: { status: "information-provided" }, reviewerAccess: { status: "public-anonymous-verified", evidence: proofPath } }));
    await writeFile(join(root, proofPath), JSON.stringify({ kind: "anonymous-reviewer-access-check", state: "passed",
      sourceSha: "1234567890123456789012345678901234567890", checks: [{ status: 404, passed: false }] }));
    await writeFile(join(root, "docs/submission/materials.json"), JSON.stringify(registry));
    await expect(verifySubmissionMaterials(root)).rejects.toThrow();
  }));
});
