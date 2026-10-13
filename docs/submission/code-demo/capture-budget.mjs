/** Restore the persisted request reservations before any new network operation. */
export function restoreCaptureBudget(budget, records, savedStopReason = null) {
  budget.records.push(...structuredClone(records));
  const unknown = records.some((record) => record.status === 'running' || record.attempted && (
    record.httpStatus === null || !Number.isInteger(record.inputTokens) || !Number.isInteger(record.outputTokens)
  ));
  const truncated = records.some((record) => record.response?.status === 'incomplete' || record.response?.stop_reason === 'max_tokens');
  const restricted = records.some((record) => [401, 403, 429].includes(record.httpStatus));
  let consecutiveFailures = 0;
  for (const record of [...records].reverse()) {
    if (record.status !== 'failed') break;
    consecutiveFailures += 1;
  }
  const reason = savedStopReason || (unknown ? 'Prior request usage or completion is unknown. Reconcile before further calls.'
    : truncated ? 'Prior model output was truncated. Reconcile before further calls.'
    : restricted ? 'Prior authorization, quota or rate-limit failure must be resolved.'
    : consecutiveFailures >= 3 ? 'Prior consecutive HTTP failures reached the stop limit.' : null);
  if (reason) budget.halt(reason);
}
