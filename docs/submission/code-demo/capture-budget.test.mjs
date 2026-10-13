import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpBudget } from '../../../scripts/holdout-http.ts';
import { restoreCaptureBudget } from './capture-budget.mjs';

// Offline regression only. These replies are never used by the recorder/video.
const config = { baseUrl: 'http://127.0.0.1:12345', model: 'offline-regression', apiKey: 'test-capture-key' };
const context = { arm: 'C-tools', questionId: 'offline-resume-guard', phase: 'before' };
const completed = { attempted: true, status: 'ok', httpStatus: 200, inputTokens: 2, outputTokens: 3 };
function setup(records, reason = null) {
  let fetches = 0;
  const budget = new HttpBudget({ maxRequests: 12, fetchImpl: async () => {
    fetches += 1;
    return new Response(JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 }, output_text: 'offline test only' }));
  } });
  restoreCaptureBudget(budget, records, reason);
  return { budget, count: () => fetches };
}
for (const [name, prior, reason] of [
  ['断线后完成未知，恢复不得再次发送HTTP', [{ ...completed, status: 'failed', httpStatus: null, inputTokens: null, outputTokens: null }], null],
  ['成功响应usage未知，恢复不得再次发送HTTP', [{ ...completed, inputTokens: null }], null],
  ['已有停机原因不会被重启清零', [completed], 'quota stopped'],
  ['模型截断后的停机在重启后保留', [{ ...completed, response: { status: 'incomplete' } }], null],
]) test(name, async () => {
  const { budget, count } = setup(prior, reason);
  await assert.rejects(() => budget.send(config, 'openai-responses', {}, context));
  assert.equal(count(), 0);
});
test('已完成且用量明确的记录允许在剩余预算内发送', async () => {
  const { budget, count } = setup([completed]);
  await budget.send(config, 'openai-responses', {}, context);
  assert.equal(count(), 1); assert.equal(budget.records.length, 2);
});
test('跨重启保留12次上限，不能清零预算', async () => {
  const { budget, count } = setup(Array.from({ length: 12 }, () => completed));
  await assert.rejects(() => budget.send(config, 'openai-responses', {}, context));
  assert.equal(count(), 0);
});
