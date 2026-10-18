import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  it("工作区预检收录新版正式画面、配音稿与精确时间轴，并保留人工待办", () => {
    const reply = spawnSync(process.execPath, ["--import", "tsx", "docs/submission/closeout/prepare-package.mjs", "--check-materials", "--json"], {
      cwd: resolve(import.meta.dirname, ".."), encoding: "utf8", windowsHide: true,
    });
    expect(reply.status, reply.stderr).toBe(0);
    const result = JSON.parse(reply.stdout);
    const paths = result.files.map((file: { path: string }) => file.path);
    expect(paths).toContain("docs/submission/tuzheng-competition-demo-2026-10-18-silent.mp4");
    expect(paths).toContain("docs/submission/demo-2026-10-18/voiceover.md");
    expect(paths).toContain("docs/submission/demo-2026-10-18/chapters.srt");
    expect(result.acceptance.formalVideo).toBe("picture-complete-voiceover-pending");
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
});
