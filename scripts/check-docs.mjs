import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// 检查已跟踪与新建文档的本地链接；不把文件存在当作网络可达或内容已验收。
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
}).split("\0").filter((file) => (/\.md$/.test(file) || file.startsWith("docs/") && file.endsWith(".html")) && existsSync(file));
const missing = [];
let checked = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8").replace(/```[^\n]*\n[\s\S]*?```/g, "");
  const links = file.endsWith(".md")
    ? [...source.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1].replace(/^<|>$/g, ""))
    : [...source.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  for (const link of links) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(link)) continue;
    const pathname = decodeURIComponent(link.split(/[?#]/)[0]);
    if (!pathname) continue;
    checked += 1;
    if (!existsSync(resolve(dirname(file), pathname))) missing.push(`${file}: ${link}`);
  }
}
if (missing.length) {
  console.error(`本地文档链接缺失 ${missing.length} 处：\n${missing.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`${files.length} 份文档，${checked} 条本地链接，0 缺失（不检查网络与锚点）。`);
}
