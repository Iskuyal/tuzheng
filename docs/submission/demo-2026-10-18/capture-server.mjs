// Production Vue client and product API, with accounting around real upstream HTTP.
import 'dotenv/config';
import express from 'express';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../../../server/app.ts';
import { createModelSettingsStore, activeProviderConfig } from '../../../server/model-settings.ts';
import { AnthropicMessagesVisionAdapter } from '../../../server/anthropic-vision.ts';
import { AnthropicSourceInvestigationDriver } from '../../../server/source-investigation.ts';
import { SOURCE_INVESTIGATION_PROMPT } from '../../../server/source-prompt.ts';
import { HttpBudget } from '../../../scripts/holdout-http.ts';
import { restoreCaptureBudget } from '../code-demo/capture-budget.mjs';

const EVIDENCE = resolve('docs/evidence/formal-demo-2026-10-18');
mkdirSync(EVIDENCE, { recursive: true });
if (!process.argv.includes('--execute')) throw new Error('Use --execute for the user-authorized 2026-10-18 recording.');
if (existsSync(resolve(EVIDENCE, 'summary.json'))) throw new Error('Completed batch: create a new recording batch.');
const store = createModelSettingsStore();
const secretValues = new Set();
const safe = value => {
  let json = JSON.stringify(value);
  for (const key of secretValues) if (key) json = json.split(key).join('[REDACTED]');
  return json;
};
function synced(name, value, flag = 'w') {
  const fd = openSync(resolve(EVIDENCE, name), flag);
  try { writeFileSync(fd, safe(value) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
}
let pinned = null, scenario = 'setup', startingBalance = null, balanceReads = 0;
const budget = new HttpBudget({ maxRequests: 18, timeoutMs: 60000, persist: async row => {
  synced('http-events.jsonl', row, 'a');
  synced('request-records.json', budget.records);
  synced('stop.json', { reason: budget.stopReason, reservations: budget.records.length });
} });
if (existsSync(resolve(EVIDENCE, 'request-records.json'))) {
  restoreCaptureBudget(budget, JSON.parse(readFileSync(resolve(EVIDENCE, 'request-records.json'), 'utf8')),
    existsSync(resolve(EVIDENCE, 'stop.json')) ? JSON.parse(readFileSync(resolve(EVIDENCE, 'stop.json'), 'utf8')).reason : null);
}
function official(settings) {
  for (const config of Object.values(settings.providers)) if (config.apiKey) secretValues.add(config.apiKey);
  const current = activeProviderConfig(settings);
  return current.provider === 'anthropic' && current.config.baseUrl.replace(/\/$/, '') === 'https://api.deepseek.com/anthropic/v1'
    && !!current.config.apiKey && !!current.config.model;
}
function checked(settings) {
  if (!official(settings) || !pinned || JSON.stringify(settings) !== JSON.stringify(pinned)) throw new Error('Recording is not armed with the pinned official configuration.');
  return activeProviderConfig(settings).config;
}
async function balance(phase) {
  const config = activeProviderConfig(pinned).config;
  balanceReads++;
  const reply = await fetch('https://api.deepseek.com/user/balance', { headers: { authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(20000) });
  if (!reply.ok) { budget.halt(`Balance unavailable: HTTP ${reply.status}`); throw new Error(budget.stopReason); }
  const payload = await reply.json();
  const amount = Number(payload.balance_infos?.find(row => row.currency === 'CNY')?.total_balance);
  if (!payload.is_available || !Number.isFinite(amount)) { budget.halt('Official balance unavailable.'); throw new Error(budget.stopReason); }
  synced('balance-events.jsonl', { phase, at: new Date().toISOString(), balanceCny: amount }, 'a');
  return amount;
}
async function requester(body) {
  if (budget.stopReason) throw new Error(budget.stopReason);
  const amount = await balance(`before-http-${budget.records.length + 1}`);
  if (amount < 2 || startingBalance - amount >= 1) { budget.halt('Agent-selected observed balance stop reached.'); throw new Error(budget.stopReason); }
  try {
    const reply = await budget.send(activeProviderConfig(pinned).config, 'anthropic', body,
      { arm: 'actual-product', questionId: scenario, phase: scenario.includes('resume') ? 'after' : 'before' });
    if (reply.stop_reason === 'max_tokens') budget.halt('Model output truncated; stop additional calls.');
    return reply;
  } catch (error) {
    const last = budget.records.at(-1);
    if (last?.attempted && last.httpStatus === null) budget.halt('Request completion unknown; reconcile before continuing.');
    throw error;
  } finally { synced('stop.json', { reason: budget.stopReason, reservations: budget.records.length }); }
}
const actual = createApp({ settingsStore: store,
  visionAdapterFactory: settings => new AnthropicMessagesVisionAdapter(checked(settings), requester),
  investigationDriverFactory: (settings, image, caption) => new AnthropicSourceInvestigationDriver(checked(settings), image, caption, SOURCE_INVESTIGATION_PROMPT, requester),
});
const app = express();
app.use(express.json({ limit: '32kb' }));
app.get('/capture/ready', async (_req, res) => {
  const settings = await store.read();
  res.json({ ready: official(settings), ...Object.fromEntries(Object.entries(activeProviderConfig(settings).config).filter(([key]) => key !== 'apiKey')), provider: settings.activeProvider, armed: !!pinned });
});
app.post('/capture/arm', async (_req, res) => {
  if (pinned || budget.stopReason) return res.status(409).json({ error: 'Already armed or stopped.' });
  const settings = await store.read();
  if (!official(settings)) return res.status(409).json({ error: 'Save the official Anthropic-compatible DeepSeek configuration in the project settings.' });
  pinned = settings;
  startingBalance = await balance('recording-start');
  const authorization = { date: '2026-10-18', userAnswer: '重新录制：我在项目设置页配好可用的 DeepSeek 官方配置，允许少量真实调用',
    scope: 'Fresh current-UI silent competition video, not a benchmark.', agentSelectedMaxHttp: 18, userMonetaryCap: null,
    observedBalanceDrawdownStopCny: 1, observedBalanceFloorCny: 2, balanceIsNotItemizedBilling: true,
    provider: 'anthropic', model: activeProviderConfig(pinned).config.model, baseUrl: activeProviderConfig(pinned).config.baseUrl,
    priorUnknownGatewayRequest: 'Unresolved, retained separately. This batch uses the official provider.' };
  synced('authorization.json', authorization);
  res.json({ armed: true, balanceCny: startingBalance, maxActualHttp: 18 });
});
app.post('/capture/scenario', (req, res) => {
  if (typeof req.body?.name !== 'string' || !/^[a-z0-9-]{1,80}$/.test(req.body.name)) return res.status(400).end();
  scenario = req.body.name; res.json({ scenario });
});
const summary = () => ({ model: pinned ? activeProviderConfig(pinned).config.model : null, maxActualHttp: 18,
  actualHttpRequests: budget.records.filter(row => row.attempted).length, reservations: budget.records.length,
  inputTokens: budget.records.every(row => row.inputTokens !== null) ? budget.records.reduce((sum, row) => sum + row.inputTokens, 0) : null,
  outputTokens: budget.records.every(row => row.outputTokens !== null) ? budget.records.reduce((sum, row) => sum + row.outputTokens, 0) : null,
  failedHttp: budget.records.filter(row => row.status === 'failed').length, stopReason: budget.stopReason,
  balanceReads, itemizedCost: null, responseFixtures: false });
app.get('/capture/summary', (_req, res) => res.json(summary()));
app.post('/capture/complete', async (_req, res) => {
  const finalBalance = pinned ? await balance('recording-complete') : null;
  const value = { ...summary(), operationStatus: 'complete', startingBalanceCny: startingBalance, finalBalanceCny: finalBalance, observedBalanceDecreaseCny: startingBalance === null ? null : Number((startingBalance - finalBalance).toFixed(6)) };
  synced('summary.json', value); budget.halt('Recording batch complete.'); res.json(value);
});
app.use((req, res, next) => {
  if (req.method === 'POST' && /^\/api\/(audit\/(image|check)|source-audit\/)/.test(req.path)) {
    const original = res.json.bind(res);
    res.json = payload => { synced('product-api.jsonl', { at: new Date().toISOString(), scenario, path: req.path, status: res.statusCode, payload }, 'a'); return original(payload); };
  }
  next();
});
// Keep user configuration edits and connection-test requests outside this recording server.
app.use('/api/settings', (req, res, next) => req.method === 'GET' ? next() : res.status(409).json({ error: { code: 'CAPTURE_SCOPE', message: '请在原项目设置页配置模型。' } }));
app.use(actual);
app.use(express.static(resolve('dist/client')));
app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve('dist/client/index.html')));
synced('runtime-provenance.json', { createdAt: new Date().toISOString(), sourceSha: process.env.DEMO_SOURCE_SHA ?? null,
  files: Object.fromEntries(['dist/client/index.html', 'web/pages/LandingPage.vue', 'web/pages/AuditPage.vue', 'web/pages/SourceAuditPage.vue', 'server/app.ts', 'server/source-investigation.ts', 'server/source-prompt.ts'].map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
  sourceState: 'Existing staged UI work preserved; the production build contains the current worktree.', responseFixtures: false });
const server = app.listen(7118, '127.0.0.1', () => console.log('Capture: http://127.0.0.1:7118 (no model calls until explicitly armed)'));
server.on('error', error => { console.error(error.code); process.exitCode = 1; });
