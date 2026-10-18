/** 当前提交材料的离线预检；验证文件和已归档视频指纹，不调用模型或代签人工验收。 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const registryPath = "docs/submission/materials.json";
const registrySchema = z.object({
  schemaVersion: z.literal(1),
  technicalReport: z.object({ path: z.string(), source: z.string() }).strict(),
  formalVideo: z.object({ path: z.string(), verification: z.string(), voiceover: z.string(), chapters: z.string(),
    status: z.literal("picture-complete-voiceover-pending") }).strict(),
  files: z.array(z.string()).min(1),
}).strict();
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function inside(root: string, path: string) {
  if (!path || isAbsolute(path) || /^[a-z]:/i.test(path) || path.includes("\\")) throw new Error(`材料路径必须为仓库相对路径：${path}`);
  const target = resolve(root, path);
  if (!target.startsWith(resolve(root) + sep)) throw new Error(`材料路径越出仓库：${path}`);
  return target;
}

export async function verifySubmissionMaterials(root = process.cwd()) {
  const registry = registrySchema.parse(JSON.parse(await readFile(inside(root, registryPath), "utf8")));
  const required = [registryPath, ...Object.values(registry.technicalReport), registry.formalVideo.path,
    registry.formalVideo.verification, registry.formalVideo.voiceover, registry.formalVideo.chapters];
  if (new Set(registry.files).size !== registry.files.length || required.some(path => !registry.files.includes(path))) {
    throw new Error("提交材料清单重复或遗漏 PDF、正式视频、配音稿、时间轴及验证记录。");
  }
  // Validate every path before reading any listed material.
  const paths = registry.files.map(path => ({ path, absolute: inside(root, path) }));
  const files = [];
  for (const { path, absolute } of paths) {
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile()) throw new Error(`交付材料不存在：${path}`);
    files.push({ path, bytes: info.size, sha256: sha256(await readFile(absolute)) });
  }
  const pdf = await readFile(inside(root, registry.technicalReport.path));
  if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("赛事报告不是 PDF；页数需另用报告构建脚本检查。");
  const proof = JSON.parse(await readFile(inside(root, registry.formalVideo.verification), "utf8"));
  const video = files.find(file => file.path === registry.formalVideo.path)!;
  if (String(proof.path).replaceAll("\\", "/") !== video.path || proof.sha256 !== video.sha256 || proof.bytes !== video.bytes) {
    throw new Error("正式视频与录制验证记录的路径、大小或 SHA-256 不一致。");
  }
  if (!Array.isArray(proof.resolution) || proof.resolution[0] < 1920 || proof.resolution[1] < 1080
    || !(proof.seconds >= 300 && proof.seconds <= 480) || proof.audioTracks !== 0 || proof.fullDecode !== "passed") {
    throw new Error("视频记录未满足 5–8 分钟、至少 1080p、已解码的无声母版要求。");
  }
  return { schemaVersion: 1, kind: "submission-materials-preflight", registry: registryPath, modelRequests: 0,
    formalVideo: { path: video.path, seconds: proof.seconds, sha256: video.sha256, resolution: proof.resolution,
      verificationScope: "Matches archived recording metadata and bytes; no new decode or owner acceptance." },
    acceptance: { formalVideo: registry.formalVideo.status, reviewerAccess: "pending", teamInformation: "pending",
      secondWindows: "pending", ownerReview: "pending", unknownHttp13: "pending", contestSubmission: "pending" }, files };
}

export function printMaterialCheck(result: Awaited<ReturnType<typeof verifySubmissionMaterials>>, json = false) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`已核对 ${result.files.length} 项当前交付材料；正式无声视频 ${result.formalVideo.seconds.toFixed(3)} 秒、至少 1080p，字节与录制指纹一致。\n普通话配音、最终人工走查与赛事提交仍待完成。0 次模型请求。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--json")) throw new Error("用法：npm run verify:materials -- [--json]");
  verifySubmissionMaterials().then(result => printMaterialCheck(result, process.argv.includes("--json"))).catch(error => {
    console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
  });
}
