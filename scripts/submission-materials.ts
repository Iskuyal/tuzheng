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
    status: z.enum(["picture-complete-voiceover-pending", "audio-provided-final-review-pending", "approved-by-user"]) }).strict(),
  acceptanceRecord: z.string().optional(),
  deliveryUpdateRecord: z.string().optional(),
  files: z.array(z.string()).min(1),
}).strict();
const closeoutSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("non-video-closeout-record"),
  team: z.object({ status: z.literal("information-provided") }).passthrough(),
  reviewerAccess: z.object({ status: z.literal("public-anonymous-verified"), evidence: z.string() }).passthrough(),
}).passthrough();
const accessProofSchema = z.object({
  kind: z.literal("anonymous-reviewer-access-check"), state: z.literal("passed"),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  checks: z.array(z.object({ status: z.literal(200), passed: z.literal(true) }).passthrough()).min(1),
}).passthrough();
const deliveryUpdateSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("user-delivery-update"),
  formalVideo: z.object({ status: z.literal("approved-by-user"), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    confirmationMethod: z.literal("user-attestation"), confirmationStatement: z.string().trim().min(1),
    confirmedAt: z.string().trim().min(1) }).passthrough().optional(),
  secondWindows: z.object({ status: z.literal("confirmed-by-user"),
    confirmationMethod: z.literal("user-attestation"), statement: z.string().trim().min(1),
    confirmedAt: z.string().trim().min(1), operator: z.string().nullable(),
    originalReportProvided: z.literal(false) }).passthrough(),
}).passthrough();
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
    registry.formalVideo.verification, registry.formalVideo.voiceover, registry.formalVideo.chapters,
    ...(registry.acceptanceRecord ? [registry.acceptanceRecord] : []),
    ...(registry.deliveryUpdateRecord ? [registry.deliveryUpdateRecord] : [])];
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
    || !(proof.seconds >= 300 && proof.seconds <= 480) || proof.fullDecode !== "passed") {
    throw new Error("视频记录未满足 5–8 分钟、至少 1080p 和完整解码要求。");
  }
  const withAudio = registry.formalVideo.status !== "picture-complete-voiceover-pending";
  if (withAudio ? !Number.isInteger(proof.audioTracks) || proof.audioTracks < 1 : proof.audioTracks !== 0) {
    throw new Error("视频音轨记录与有声成片／无声母版状态不一致。");
  }
  let teamInformation = "pending";
  let reviewerAccess = "pending";
  let acceptanceEvidence;
  let secondWindows = "pending";
  let deliveryUpdateEvidence;
  if (registry.formalVideo.status === "approved-by-user" && !registry.deliveryUpdateRecord) {
    throw new Error("视频最终确认缺少用户确认记录。");
  }
  if (registry.acceptanceRecord) {
    const record = closeoutSchema.parse(JSON.parse(await readFile(inside(root, registry.acceptanceRecord), "utf8")));
    if (!registry.files.includes(record.reviewerAccess.evidence)) throw new Error("匿名访问证明未收录在交付材料中。");
    const access = accessProofSchema.parse(JSON.parse(await readFile(inside(root, record.reviewerAccess.evidence), "utf8")));
    teamInformation = record.team.status;
    reviewerAccess = record.reviewerAccess.status;
    acceptanceEvidence = { record: registry.acceptanceRecord, reviewerAccessSourceSha: access.sourceSha,
      scope: "Archived user information and anonymous access checks only; later commits and human acceptance require separate evidence." };
  }
  if (registry.deliveryUpdateRecord) {
    const update = deliveryUpdateSchema.parse(JSON.parse(await readFile(inside(root, registry.deliveryUpdateRecord), "utf8")));
    if (registry.formalVideo.status === "approved-by-user" && update.formalVideo?.sha256 !== video.sha256) {
      throw new Error("视频最终确认不属于当前视频字节。");
    }
    secondWindows = update.secondWindows.status;
    deliveryUpdateEvidence = { record: registry.deliveryUpdateRecord,
      secondWindowsScope: "User confirms acceptance by another developer; original machine report not provided. Not agent-executed verification.",
      ...(registry.formalVideo.status === "approved-by-user" ? { formalVideoScope: "User confirms full viewing/listening and final acceptance of the exact video hash; not agent listening signoff or owner question review." } : {}) };
  }
  return { schemaVersion: 1, kind: "submission-materials-preflight", registry: registryPath, modelRequests: 0,
    formalVideo: { path: video.path, seconds: proof.seconds, sha256: video.sha256, resolution: proof.resolution, audioTracks: proof.audioTracks,
      verificationScope: "Matches archived recording metadata and bytes; no new decode or owner acceptance." },
    acceptance: { formalVideo: registry.formalVideo.status, reviewerAccess, teamInformation,
      secondWindows, ownerReview: "pending", unknownHttp13: "pending", contestSubmission: "pending" },
    ...(acceptanceEvidence ? { acceptanceEvidence } : {}),
    ...(deliveryUpdateEvidence ? { deliveryUpdateEvidence } : {}), files };
}

export function printMaterialCheck(result: Awaited<ReturnType<typeof verifySubmissionMaterials>>, json = false) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`已核对 ${result.files.length} 项当前交付材料；正式视频 ${result.formalVideo.seconds.toFixed(3)} 秒、至少 1080p、${result.formalVideo.audioTracks} 条音轨，字节与归档指纹一致。\n${result.acceptance.formalVideo === "approved-by-user" ? "视频已获用户最终确认；负责人抽查与赛事提交仍待完成。" : `${result.acceptance.formalVideo === "picture-complete-voiceover-pending" ? "普通话配音、" : ""}最终人工走查与赛事提交仍待完成。`}0 次模型请求。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--json")) throw new Error("用法：npm run verify:materials -- [--json]");
  verifySubmissionMaterials().then(result => printMaterialCheck(result, process.argv.includes("--json"))).catch(error => {
    console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
  });
}
