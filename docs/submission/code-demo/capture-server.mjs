// This is the actual product API and production client. The only transport
// wrapper counts real upstream HTTP requests and writes the existing audit log.
import 'dotenv/config';
import express from 'express';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../../../server/app.ts';
import { createModelSettingsStore, activeProviderConfig } from '../../../server/model-settings.ts';
import { OpenAIResponsesVisionAdapter } from '../../../server/openai-vision.ts';
import { AnthropicMessagesVisionAdapter } from '../../../server/anthropic-vision.ts';
import { ResponsesSourceInvestigationDriver, AnthropicSourceInvestigationDriver } from '../../../server/source-investigation.ts';
import { SOURCE_INVESTIGATION_PROMPT } from '../../../server/source-prompt.ts';
import { HttpBudget } from '../../../scripts/holdout-http.ts';
import { restoreCaptureBudget } from './capture-budget.mjs';

if (!process.argv.includes('--execute')) {
  console.error('Live capture requires explicit --execute and fresh user authorization.');
  process.exit(1);
}
const evidence = resolve('docs/evidence/product-live-demo-2026-10-13');
mkdirSync(evidence, { recursive: true });
const store = createModelSettingsStore();
const settings = await store.read();
const { provider, config } = activeProviderConfig(settings);
if (!config.apiKey) throw new Error('The configured model key is missing.');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const safe = (value) => JSON.parse(JSON.stringify(value).split(config.apiKey).join('[REDACTED]'));
function synced(path, text, flag = 'w') {
  const file = openSync(path, flag);
  try { writeFileSync(file, text); fsyncSync(file); } finally { closeSync(file); }
}
function journal(name, value) { synced(resolve(evidence, name), `${JSON.stringify(safe(value))}\n`, 'a'); }
const authorizationPath = resolve(evidence, 'authorization.json');
const priorPath = resolve(evidence, 'request-records.json');
const stopPath = resolve(evidence, 'stop.json');
const completedSummary = resolve(evidence, 'summary.json');
if (existsSync(completedSummary) && JSON.parse(readFileSync(completedSummary, 'utf8')).operationStatus === 'complete') {
  throw new Error('This recording authorization is complete. A later live recording needs a new authorization and evidence directory.');
}
if (!existsSync(authorizationPath)) {
  synced(authorizationPath, JSON.stringify({
    authorizedOn: '2026-10-13', authorizationScope: 'this chat and this product recording',
    userAnswer: '允许真实调用，录制实际核验结果（推荐）',
    maxActualHttpRequests: 12, monetaryBudget: null, knownFeeRate: null,
    source: store.source, provider, model: config.model, baseUrl: config.baseUrl,
    images: ['web/public/samples/conflict.png', 'web/public/samples/cpi-2025-12.png'].map((file) => ({ file, sha256: hash(readFileSync(file)) })),
    createdAt: new Date().toISOString(),
  }, null, 2) + '\n', 'wx');
}
const authorization = JSON.parse(readFileSync(authorizationPath, 'utf8'));
if (authorization.maxActualHttpRequests !== 12 || authorization.model !== config.model || authorization.baseUrl !== config.baseUrl) {
  throw new Error('The saved authorization does not match this run.');
}
const budget = new HttpBudget({
  maxRequests: 12, timeoutMs: 60000,
  persist: async (record) => {
    journal('http-events.jsonl', record);
    const latest = resolve(evidence, 'request-records.tmp.json');
    synced(latest, JSON.stringify(safe(budget.records), null, 2) + '\n');
    renameSync(latest, priorPath);
    saveStop();
  },
});
if (existsSync(priorPath)) {
  const prior = JSON.parse(readFileSync(priorPath, 'utf8'));
  const reason = existsSync(stopPath) ? JSON.parse(readFileSync(stopPath, 'utf8')).stopReason : null;
  restoreCaptureBudget(budget, prior, reason);
}
function saveStop() {
  synced(stopPath, JSON.stringify({ stopReason: budget.stopReason, recordedRequests: budget.records.length }, null, 2) + '\n');
}

function outputText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  return (payload.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text).join('');
}
function requester(kind) {
  return async (body) => {
    let raw;
    try { raw = await budget.send(config, provider, body, { arm: 'actual-product', questionId: kind, phase: 'before' }); }
    catch (error) {
      const last = budget.records.at(-1);
      if (last?.attempted && last.httpStatus === null) budget.halt('Actual request completion is unknown; reconcile before further calls.');
      saveStop();
      throw error;
    }
    if (raw.status === 'incomplete' || raw.stop_reason === 'max_tokens') {
      budget.halt('Actual model output was truncated; stop further model calls.');
      saveStop();
    }
    // Match the SDK's convenience property, derived only from the real response.
    return provider === 'openai-responses' ? { ...raw, output_text: outputText(raw) } : raw;
  };
}
const actualApp = createApp({
  settingsStore: store,
  visionAdapterFactory: () => provider === 'openai-responses'
    ? new OpenAIResponsesVisionAdapter(config, requester('uploaded-growth-image'))
    : new AnthropicMessagesVisionAdapter(config, requester('uploaded-growth-image')),
  investigationDriverFactory: (_settings, image, caption) => provider === 'openai-responses'
    ? new ResponsesSourceInvestigationDriver(config, image, caption, SOURCE_INVESTIGATION_PROMPT, requester('cpi-image-and-caption'))
    : new AnthropicSourceInvestigationDriver(config, image, caption, SOURCE_INVESTIGATION_PROMPT, requester('cpi-image-and-caption')),
});
const app = express();
app.use((req, res, next) => {
  if (req.method === 'POST' && /^\/api\/(audit\/(image|check)|source-audit\/)/.test(req.path)) {
    const original = res.json.bind(res);
    res.json = (payload) => {
      journal('product-api.jsonl', { time: new Date().toISOString(), path: req.path, status: res.statusCode, payload });
      return original(payload);
    };
  }
  next();
});
app.get('/capture/summary', (_req, res) => {
  const rows = budget.records;
  const summary = {
    mode: 'actual-product-live-recording', source: store.source, provider, model: config.model,
    maximumHttpRequests: 12, reservedRequests: rows.length,
    actualHttpRequests: rows.filter((row) => row.attempted).length,
    inputTokens: rows.every((row) => row.inputTokens !== null) ? rows.reduce((sum, row) => sum + row.inputTokens, 0) : null,
    outputTokens: rows.every((row) => row.outputTokens !== null) ? rows.reduce((sum, row) => sum + row.outputTokens, 0) : null,
    failedHttp: rows.filter((row) => row.status === 'failed').length,
    stopReason: budget.stopReason, cost: null, feeRate: null,
  };
  synced(resolve(evidence, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  res.json(summary);
});
// A connection test is outside the two explicitly recorded product paths.
app.post('/api/settings/test-connection', (_req, res) => res.status(409).json({ error: { code: 'CAPTURE_SCOPE', message: '本次实录只启用图表读取与来源核验。' } }));
app.use(actualApp);
app.use(express.static(resolve('dist/client')));
app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve('dist/client/index.html')));
const server = app.listen(7109, '127.0.0.1');
server.once('listening', () => console.log(JSON.stringify({ url: 'http://127.0.0.1:7109', provider, model: config.model, remainingHttp: 12 - budget.records.length })));
server.once('error', () => { console.error('Capture server failed to listen.'); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
