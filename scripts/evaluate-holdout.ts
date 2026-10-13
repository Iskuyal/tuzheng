/** 唯一CLI为离线验证/已有记录重算；没有收费运行开关，也不读用户模型配置。 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle, runEvaluation, rescoreEvaluation, type Evaluation } from "./holdout-evaluation.js";
import { offlineTransports } from "./holdout-fixtures.js";

export async function main(argv: string[]): Promise<void> {
  if (argv.some(a => !["--verify", "--offline", "--report", "--output"].includes(a) && a.startsWith("--"))) throw new Error("仅允许离线核验或报告重算，本CLI不调用真实模型。");
  const bundle = await loadBundle();
  if (argv.includes("--verify")) { console.log("冻结包：12题/三臂/来源/图片/提示词/运行代码指纹通过。0次模型请求。"); return; }
  if (argv.includes("--report")) {
    const path = argv[argv.indexOf("--report") + 1]; if (!path) throw new Error("需要记录文件路径。");
    const report = rescoreEvaluation(bundle, JSON.parse(await readFile(resolve(path), "utf8")) as Evaluation);
    console.log(JSON.stringify({ mode: report.mode, ...report.summary }, null, 2)); return;
  }
  if (!argv.includes("--offline")) throw new Error("用 --verify、--offline 或 --report 文件；收费运行仅有计划。");
  const index = argv.indexOf("--output");
  const output = resolve(index < 0 ? ".cache/holdout/offline-fixture.json" : argv[index + 1]);
  await mkdir(dirname(output), { recursive: true });
  // 明确输出是替身证据，每阶段落盘；重跑请另选路径保存，不覆盖正式历史。
  try { await readFile(output); throw new Error("输出已存在，请指定新的 --output 路径以保留历史。"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const report = await runEvaluation(bundle, offlineTransports(), { repeats: 1, mode: "offline-fixture",
    checkpoint: async snapshot => { await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`); } });
  console.log("离线替身验证：36条完整路径/42个计划阶段，含故意失败、遗漏与退化；结果不代表模型质量。");
  for (const arm of report.summary.arms) console.log(`${arm.arm}: 路径 ${arm.paths.passed}/${arm.paths.total}，失败 ${arm.failed}，阻塞 ${arm.blocked}，记录替身请求 ${arm.requests}（收费模型请求0）。`);
  console.log(`记录：${output}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
