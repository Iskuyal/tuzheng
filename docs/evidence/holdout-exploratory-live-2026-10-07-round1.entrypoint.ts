import 'dotenv/config';
import { readFile, open } from 'node:fs/promises';
import { createModelSettingsStore, activeProviderConfig } from '../server/model-settings.js';
import { verifyCandidate, writeNewJson } from '../scripts/candidate-preflight.js';
import { runHttpEvaluation } from '../scripts/run-holdout-http.js';
import { sha256 } from '../scripts/holdout-evaluation.js';
const candidate = await verifyCandidate(JSON.parse(await readFile('docs/evidence/final-candidate-2026-10-07-round2.json', 'utf8')));
const authorization = JSON.parse(await readFile('docs/evidence/live-evaluation-authorization-2026-10-07.json', 'utf8'));
const demo = JSON.parse(await readFile('docs/evidence/final-demo-live-2026-10-07-round1/report.json', 'utf8'));
if (demo.transport.state === 'running') throw new Error('五题复验仍在运行；保持串行。');
if (demo.transport.stopReason && !demo.transport.stopReason.includes('HTTP请求上限')) throw new Error('五题出现需处理的停止条件；不得继续真实调用。');
const store = createModelSettingsStore(); const { provider, config } = activeProviderConfig(await store.read());
if (provider !== demo.runtime.provider || config.model !== demo.runtime.model || config.baseUrl !== demo.runtime.baseUrl) throw new Error('与五题有效模型配置不同，停止。');
if (!config.apiKey) throw new Error('缺少密钥。');
const output = 'docs/evidence/holdout-exploratory-live-2026-10-07-round1';
// 单独探索入口；正式CLI的负责人签字门槛保留。授权侧文件先落盘，结果不会伪造owner签字。
const entrypointBytes = await readFile('.cache/run-exploratory-holdout.ts');
await writeNewJson(`${output}.purpose.json`, { ...authorization, entrypointSha256: sha256(entrypointBytes), entrypoint: '.cache/run-exploratory-holdout.ts' });
const entrypointFile = await open(`${output}.entrypoint.ts`, 'wx');
try { await entrypointFile.writeFile(entrypointBytes); await entrypointFile.sync(); } finally { await entrypointFile.close(); }
console.log('开始未盲审探索：ownerReview=pending，最多360实际HTTP，保留全部108路径/126阶段。');
const report = await runHttpEvaluation({ config, provider, configSource: store.source ?? 'file', candidate, maxRequests: 360, output });
await writeNewJson(`${output}/exploratory-report.json`, { ...report, evaluationPurpose: 'exploratory-not-owner-reviewed', ownerReviewStatus: 'pending', authorization });
const events = await open(`${output}/events.jsonl`, 'a');
try { await events.writeFile(JSON.stringify({ type: 'exploratory-qualification', value: { ownerReviewStatus: 'pending', purpose: '非正式独立盲审验证' } }) + '\n'); await events.sync(); } finally { await events.close(); }
console.log(`未盲审探索结束：HTTP ${report.transport.requests.filter(r => r.attempted).length}/360，${report.transport.state}，金额未知。`);
