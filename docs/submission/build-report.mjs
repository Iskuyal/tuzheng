// 生成开发技术 PDF 或独立赛事 PDF（A4、页脚页码；开发版目录自动回填）。
// 用法：node docs/submission/build-report.mjs [--competition] [--check]
//   --check 只校验页数（≤30）并打印，不重写 PDF。
// 依赖：playwright（仓库已有，使用系统自带 Edge）＋ 可选的 python pypdf（用于回填目录页码）。
// 赛事要求 PDF 不超过 30 页，本脚本在超页时以退出码 1 结束。
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const competition = process.argv.includes("--competition");
const htmlPath = `docs/submission/${competition ? "competition-report" : "technical-report"}.html`;
const pdfPath = `docs/submission/web-match-${competition ? "competition" : "technical"}-report.pdf`;
// 临时副本必须落在 assets/ 同级目录：图片用的是相对路径，file:// 页面只能读同目录树。
const stagedPath = `docs/submission/.${competition ? "competition" : "technical"}-report-build.html`;
const checkOnly = process.argv.includes("--check");
const MAX_PAGES = 30;

// 校验已经保存的交付文件；不能重渲染 HTML 后把另一个 PDF 的页数当成交付验证。
if (checkOnly) {
  if (!existsSync(pdfPath)) {
    console.error("PDF 不存在：", pdfPath);
    process.exit(1);
  }
  const pages = pageCount(pdfPath);
  console.log(`现有 PDF：${pdfPath}；页数：${pages} / 上限 ${MAX_PAGES}`);
  process.exit(pages > MAX_PAGES || pages < 1 ? 1 : 0);
}

const shortCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
let baseHtml = readFileSync(htmlPath, "utf8")
  .replaceAll("__COMMIT__", shortCommit)
  .replaceAll("__DATE__", today);
// PDF 脱离本机后也能核查出处；HTML 本地源仍保留可由 docs:check 核对的相对链接。
if (competition) {
  const committedFiles = new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { encoding: "utf8" }).trim().split("\n"));
  baseHtml = baseHtml.replace(/href="([^\"]+)"/g, (match, href) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return match;
    const localPath = resolve(dirname(htmlPath), href);
    const repoPath = relative(resolve("."), localPath).replaceAll("\\", "/");
    const kind = /\.[^/]+$/.test(repoPath) ? "blob" : "tree";
    if (kind === "blob" && !committedFiles.has(repoPath)) return `title="配套仓库材料：${repoPath}"`;
    return `href="https://github.com/Iskuyal/web-match/${kind}/${shortCommit}/${repoPath.split("/").map(encodeURIComponent).join("/")}"`;
  });
}

const tmp = mkdtempSync(join(tmpdir(), "report-"));
const browser = await chromium.launch({ channel: "msedge" });

async function render(html, target) {
  writeFileSync(stagedPath, html, "utf8");
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve(stagedPath)).href, { waitUntil: "load" });
  await page.emulateMedia({ media: "print" });
  // 图片是 file:// 子资源，等全部真正解码完成再打印，否则 PDF 里会出现空白框。
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0), null, {
    timeout: 30_000,
  });
  await page.pdf({
    path: target,
    format: "A4",
    printBackground: true,
    margin: { top: "16mm", bottom: "16mm", left: "15mm", right: "15mm" },
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate:
      '<div style="width:100%;font-size:8pt;color:#52646b;padding:0 15mm;display:flex;justify-content:space-between;">' +
      `<span>图证 · ${competition ? "赛事技术报告" : "技术报告"}（${today}）</span>` +
      '<span>第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页</span></div>',
  });
  await page.close();
}

/**
 * 用 pypdf 找出每个目录条目所在页码；不可用时返回 null（目录页码留空）。
 * python 必须带 `-X utf8`：Windows 中文控制台下 python 默认 stdout 编码是 gbk，
 * 含中文的锚点 JSON 会被按 utf8 解码成乱码键，页码回填会「只告警不生效」。
 */
function locateTocPages(pdfFile, anchors) {
  const script = `
import json, sys
from pypdf import PdfReader
reader = PdfReader(sys.argv[1])
anchors = json.loads(sys.argv[2])
found = {}
for index, page in enumerate(reader.pages, start=1):
    try:
        text = page.extract_text() or ""
    except Exception:
        text = ""
    flat = "".join(text.split())
    for anchor in anchors:
        key = "".join(anchor.split())
        if anchor not in found and key in flat:
            found[anchor] = index
print(json.dumps(found, ensure_ascii=False))
`;
  try {
    const out = execFileSync("python", ["-X", "utf8", "-c", script, pdfFile, JSON.stringify(anchors)], { encoding: "utf8" });
    return JSON.parse(out.trim());
  } catch (error) {
    console.warn("目录页码回填跳过（需要 python + pypdf）：", String(error).split("\n")[0]);
    return null;
  }
}

function pageCount(pdfFile) {
  const script = `
import sys
from pypdf import PdfReader
print(len(PdfReader(sys.argv[1]).pages))
`;
  return Number(execFileSync("python", ["-X", "utf8", "-c", script, pdfFile], { encoding: "utf8" }).trim());
}

try {
  const anchors = [...baseHtml.matchAll(/data-toc="([^"]+)"/g)].map((match) => match[1]);
  let html = baseHtml;
  if (anchors.length) {
    const draft = join(tmp, "draft.pdf");
    await render(baseHtml, draft);
    const located = locateTocPages(draft, anchors);
    if (located) {
      for (const [anchor, pageNumber] of Object.entries(located)) {
        html = html.replace(`data-toc="${anchor}"></span>`, `data-toc="${anchor}">${pageNumber}</span>`);
      }
      const missing = anchors.filter((anchor) => !(anchor in located));
      if (missing.length) throw new Error(`目录页码未定位：${missing.join("、")}`);
    }
  }
  const candidate = join(tmp, "final.pdf");
  await render(html, candidate);
  const pages = pageCount(candidate);
  console.log(`页数：${pages} / 上限 ${MAX_PAGES}`);
  if (pages > MAX_PAGES || pages < 1) throw new Error("PDF 页数不满足赛事要求，保留已有交付文件。");
  // 赛事源一节一页，目录写明页码；内容溢出时不能悄悄发布错误的目录。
  const sectionCount = [...baseHtml.matchAll(/<section class="sheet\b/g)].length;
  if (competition && pages !== sectionCount) throw new Error(`赛事版 ${sectionCount} 节排成 ${pages} 页，请修复分页与目录，保留已有文件。`);
  writeFileSync(pdfPath, readFileSync(candidate));
  console.log("已写入", pdfPath);
} finally {
  await browser.close();
  rmSync(stagedPath, { force: true });
  // 仅删除本脚本创建的唯一临时目录，不接收用户路径。
  if (dirname(resolve(tmp)) !== resolve(tmpdir())) throw new Error("临时目录超出预期位置，拒绝清理。");
  rmSync(tmp, { recursive: true, force: true });
}
