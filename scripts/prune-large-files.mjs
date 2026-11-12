#!/usr/bin/env node
/**
 * 仓库瘦身预演：列出体积最大的受控视频/录屏，给出移出版本控制后的账面变化。
 *
 * ⚠ 风险说明（务必先读）
 * - 本脚本默认 dry-run，只读 `git ls-tree` 与材料清单，不改索引、不动磁盘文件。
 * - `--apply` 只执行 `git rm --cached <path>`：文件从版本控制（索引）移除，本地磁盘文件保留。
 *   它不删除、不重写任何 blob，因此 **不会让 .git 变小，也不会让已有 clone 变小**。
 * - 历史提交里仍含这些 blob。要让新 clone 真正变小，必须用 git filter-repo 重写历史，
 *   那会改写提交 SHA，并让材料里登记的文件哈希（docs/submission/materials.json、
 *   证据 JSON 的 sha256/bytes）全部失效，需负责人确认后单独执行。本脚本不碰历史。
 * - 被移出索引的文件会变成未跟踪状态。脚本不写 .gitignore，需要人手动补。
 * - 材料清单里登记过的交付物若被移出，新 clone 将缺少该文件，`npm run verify:materials`
 *   会报「交付材料不存在」。是否调整清单/改托管方式由负责人决定，脚本只提示。
 *
 * 用法：
 *   node scripts/prune-large-files.mjs                  # dry-run（默认）
 *   node scripts/prune-large-files.mjs --min-size=10    # 改阈值（MiB）
 *   node scripts/prune-large-files.mjs --all-large      # 不限定扩展名，只看体积
 *   node scripts/prune-large-files.mjs --apply          # 真正执行 git rm --cached
 *   node scripts/prune-large-files.mjs --help
 *
 * 无第三方依赖，Node 20+ ESM。退出码：0 正常；1 有文件移除失败；2 参数或 git 调用错误。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIB = 1024 * 1024;
const DEFAULT_MIN_SIZE_MIB = 5;
const MEDIA_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"]);
const MATERIALS_PATH = "docs/submission/materials.json";

const fail = (message) => {
  console.error(message);
  process.exit(2);
};

const USAGE = `用法：
  node scripts/prune-large-files.mjs                  # dry-run（默认，只读）
  node scripts/prune-large-files.mjs --min-size=10    # 改体积阈值（MiB）
  node scripts/prune-large-files.mjs --all-large      # 不限定扩展名，只看体积
  node scripts/prune-large-files.mjs --apply          # 真正执行 git rm --cached（保留本地文件）
  node scripts/prune-large-files.mjs --help

说明：--apply 只把文件移出版本控制，不改历史、不改 .gitignore；.git 与已有 clone 都不会因此变小。`;

// ---------- 参数 ----------
const options = { apply: false, allLarge: false, minSizeMiB: DEFAULT_MIN_SIZE_MIB, help: false };
for (const arg of process.argv.slice(2)) {
  if (arg === "--apply") options.apply = true;
  else if (arg === "--all-large") options.allLarge = true;
  else if (arg === "--help" || arg === "-h") options.help = true;
  else if (arg.startsWith("--min-size=")) {
    const value = Number(arg.slice("--min-size=".length));
    if (!Number.isFinite(value) || value <= 0) fail(`--min-size 需要正数（单位 MiB），收到：${arg}`);
    options.minSizeMiB = value;
  } else fail(`未知参数：${arg}\n用 --help 查看用法。`);
}

if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

// ---------- git ----------
const git = (argv) => execFileSync("git", argv, { cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * MIB });

let head = { branch: "(detached)", commit: "", commits: 0, sizePack: "未知" };
try {
  head.branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  head.commit = git(["rev-parse", "--short", "HEAD"]).trim();
  head.commits = Number(git(["rev-list", "--count", "HEAD"]).trim());
  const counted = git(["count-objects", "-vH"]);
  head.sizePack = (counted.match(/^size-pack:\s*(.+)$/m) ?? [])[1]?.trim() ?? "未知";
} catch (error) {
  fail(`读取 git 状态失败（是否在仓库内？）：${error.message}`);
}

const tracked = (() => {
  const raw = git(["ls-tree", "-r", "-l", "-z", "HEAD"]);
  return raw
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const tab = record.indexOf("\t");
      if (tab < 0) return null;
      const [mode, type, hash, size] = record.slice(0, tab).trim().split(/\s+/);
      const sizeBytes = Number(size);
      if (type !== "blob" || !Number.isFinite(sizeBytes)) return null;
      return { path: record.slice(tab + 1), hash, size: sizeBytes, mode };
    })
    .filter(Boolean);
})();

// ---------- 材料清单登记（只读） ----------
const registered = (() => {
  const absolute = resolve(repoRoot, MATERIALS_PATH);
  if (!existsSync(absolute)) return new Set();
  try {
    const manifest = JSON.parse(readFileSync(absolute, "utf8"));
    const list = [...(Array.isArray(manifest.files) ? manifest.files : []), manifest.formalVideo?.path, manifest.technicalReport?.path];
    return new Set(list.filter((entry) => typeof entry === "string"));
  } catch (error) {
    console.warn(`（材料清单读取失败，本表不标记「材料登记」：${error.message}）`);
    return new Set();
  }
})();

// ---------- 选行 ----------
const threshold = Math.round(options.minSizeMiB * MIB);
const extensionOf = (path) => (path.match(/\.[^./]+$/)?.[0] ?? "").toLowerCase();
const isMedia = (path) => MEDIA_EXTENSIONS.has(extensionOf(path));

const candidates = tracked
  .filter((entry) => entry.size >= threshold && (options.allLarge || isMedia(entry.path)))
  .sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));

const skippedLarge = options.allLarge ? [] : tracked.filter((entry) => entry.size >= threshold && !isMedia(entry.path)).sort((a, b) => b.size - a.size);

const uniqueBlobs = new Map();
for (const entry of candidates) {
  const hits = uniqueBlobs.get(entry.hash) ?? [];
  hits.push(entry.path);
  uniqueBlobs.set(entry.hash, hits);
}

const trackedBytes = tracked.reduce((sum, entry) => sum + entry.size, 0);
const selectedPathBytes = candidates.reduce((sum, entry) => sum + entry.size, 0);
const selectedBlobBytes = [...uniqueBlobs.keys()].reduce((sum, hash) => sum + tracked.find((entry) => entry.hash === hash).size, 0);
const remainingBytes = trackedBytes - selectedPathBytes;
const remainingFiles = tracked.length - candidates.length;
const sharedBlobs = [...uniqueBlobs.entries()].filter(([, paths]) => paths.length > 1);

// ---------- 表格 ----------
const displayWidth = (text) =>
  [...text].reduce((sum, char) => {
    const code = char.codePointAt(0);
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faFF) ||
      (code >= 0x20000 && code <= 0x3fffd);
    return sum + (wide ? 2 : 1);
  }, 0);

const padCell = (text, width, align) => {
  const fill = " ".repeat(Math.max(0, width - displayWidth(text)));
  return align === "right" ? fill + text : text + fill;
};

function renderTable(headers, rows, aligns = []) {
  const widths = headers.map((header, index) => Math.max(displayWidth(header), ...rows.map((row) => displayWidth(row[index] ?? ""))));
  const rule = (left, joint, right) => left + widths.map((width) => "─".repeat(width + 2)).join(joint) + right;
  const inline = (cells) => "│ " + cells.map((cell, index) => padCell(cell ?? "", widths[index], aligns[index])).join(" │ ") + " │";
  return [rule("┌", "┬", "┐"), inline(headers), rule("├", "┼", "┤"), ...rows.map(inline), rule("└", "┴", "┘")].join("\n");
}

const mib = (bytes) => (bytes / MIB).toFixed(2);

// ---------- 输出 ----------
console.log(`图证仓库瘦身预演 · ${options.apply ? "执行模式 --apply" : "只读预演 dry-run"}`);
console.log(`仓库：${repoRoot.replace(/\\/g, "/")}`);
console.log(`HEAD：${head.branch} @ ${head.commit}（${head.commits} 次提交）`);
console.log(
  `筛选：单文件 ≥ ${options.minSizeMiB.toFixed(2)} MiB${options.allLarge ? "（不限扩展名）" : "，且扩展名为视频/录屏（--all-large 可放宽）"}`,
);
console.log(`受控文件：${tracked.length} 个，合计 ${mib(trackedBytes)} MiB；.git 的 size-pack：${head.sizePack}`);
console.log("");

if (!candidates.length) {
  console.log(`没有达到阈值的文件，无需处理。`);
  process.exit(0);
}

const rows = candidates.map((entry, index) => [
  String(index + 1),
  entry.path,
  mib(entry.size),
  uniqueBlobs.get(entry.hash).length > 1 ? `${entry.hash.slice(0, 8)}（共用）` : entry.hash.slice(0, 8),
  registered.has(entry.path) ? "是" : "—",
]);

console.log(options.apply ? "本次将从版本控制移除（git rm --cached：仅移出索引，本地文件保留）" : "将要移出版本控制（git rm --cached：仅移出索引，本地文件保留）");
console.log(renderTable(["#", "文件（仓库相对路径）", "大小 MiB", "blob", "材料登记"], rows, [null, null, "right", null, null]));
console.log("");

let failures = [];
if (options.apply) {
  let removedBytes = 0;
  for (const entry of candidates) {
    try {
      git(["rm", "--cached", "--", entry.path]);
      removedBytes += entry.size;
      console.log(`  已移出索引：${entry.path}`);
    } catch (error) {
      const message = `${error.stderr ?? ""}`.trim().split("\n")[0] || error.message;
      failures.push(`${entry.path}：${message}`);
      console.error(`  失败：${entry.path} —— ${message}`);
    }
  }
  console.log("");
  console.log(`共 ${candidates.length - failures.length}/${candidates.length} 个文件已从索引移除，累计 ${mib(removedBytes)} MiB（按路径求和）。`);
  if (failures.length) {
    console.error(`有 ${failures.length} 个文件未能移除，需要人工处理：\n${failures.join("\n")}`);
  }
  console.log("");
} else {
  console.log(`共 ${candidates.length} 个文件，累计 ${mib(selectedPathBytes)} MiB（按路径求和）`);
  console.log(`其中独立 blob ${uniqueBlobs.size} 个，去重后 ${mib(selectedBlobBytes)} MiB`);
  for (const [hash, paths] of sharedBlobs) {
    console.log(`  共用同一 blob（${hash.slice(0, 8)}）：${paths.join(" / ")} —— 移出一个不会减少对象体积`);
  }
  console.log(`受控文件移除后：预计剩余 ${mib(remainingBytes)} MiB / ${remainingFiles} 个文件`);
  console.log(`.git 现在 ${head.sizePack}，执行后不会变小：历史提交里仍有这些 blob，clone 一样要下载。`);
  console.log("");
}

if (skippedLarge.length) {
  console.log(`未纳入的大文件（达阈值但非视频，需 --all-large 才会列入）`);
  for (const entry of skippedLarge) console.log(`  ${mib(entry.size).padStart(7)} MiB  ${entry.path}`);
  console.log("");
}

const registeredCandidates = candidates.filter((entry) => registered.has(entry.path));
if (registeredCandidates.length) {
  console.log(`材料清单登记提示：${registeredCandidates.length} 个候选在 ${MATERIALS_PATH} 里登记为交付物`);
  for (const entry of registeredCandidates) console.log(`  ${entry.path}`);
  console.log(`  移出后新 clone 将缺少这些文件，npm run verify:materials 会报「交付材料不存在」。`);
  console.log(`  清单是否调整、视频改由何处托管需要负责人决定；本脚本不修改 ${MATERIALS_PATH}。`);
  console.log("");
}

if (options.apply) {
  console.log("后续步骤（脚本不代做）");
  console.log(`  1. 补 .gitignore 或 .git/info/exclude，否则这些文件会一直显示为未跟踪（本脚本没有改 .gitignore）。`);
  console.log(`  2. 由负责人提交这次 git rm --cached（本轮不提交、不 push）。`);
  console.log(`  3. 不要期望 clone 变小：blob 仍在历史。要让新 clone 真正变小，需要用`);
  console.log(`     git filter-repo --path <路径> --invert-paths 重写历史，会改写提交 SHA、`);
  console.log(`     并让材料里登记的 sha256/bytes 失效，必须负责人确认后单独执行。`);
} else {
  console.log(`本次为 dry-run：索引、工作区和 .gitignore 均未改动，磁盘文件也没有动。`);
  console.log(`确认后再执行 node scripts/prune-large-files.mjs --apply（由负责人运行，并自行提交）。`);
}

process.exitCode = failures.length ? 1 : 0;
