export function buildShadowRelayerJobPatch(job, { liveExecutionEnabled = false } = {}) {
  const now = new Date().toISOString();
  if (!job) {
    return {
      state: 'failed',
      lastError: 'missing_shadow_relayer_job',
      lastEvaluatedAt: now
    };
  }
  if (String(job.mode || 'shadow') !== 'shadow') {
    return {
      state: 'skipped',
      reason: 'non_shadow_mode',
      lastEvaluatedAt: now
    };
  }
  if (liveExecutionEnabled) {
    return {
      state: 'ready_for_broadcast',
      liveExecutionEnabled: true,
      lastEvaluatedAt: now
    };
  }
  return {
    state: 'simulated',
    liveExecutionEnabled: false,
    simulatedAt: now,
    lastEvaluatedAt: now,
    reason: job.direction === 'inbound_topup' ? 'inbound_payment_shadow_only' : 'shadow_relayer_dry_run'
  };
}
