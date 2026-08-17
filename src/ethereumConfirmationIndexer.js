export function buildConfirmationIndexerJobPatch(job, { rpcConfigured = false, autoConfirm = false, requiredConfirmations = 1 } = {}) {
  const now = new Date().toISOString();
  if (!job) {
    return {
      state: 'failed',
      lastError: 'missing_confirmation_job',
      lastCheckedAt: now
    };
  }
  if (!job.txHash) {
    return {
      state: 'awaiting_tx_hash',
      lastCheckedAt: now
    };
  }
  if (!rpcConfigured) {
    return {
      state: 'watching',
      rpcConfigured: false,
      confirmationsObserved: Number(job.confirmationsObserved || 0),
      requiredConfirmations: Number(job.requiredConfirmations || requiredConfirmations),
      lastCheckedAt: now,
      reason: 'rpc_not_configured'
    };
  }
  if (autoConfirm) {
    return {
      state: 'confirmed',
      rpcConfigured: true,
      confirmationsObserved: Math.max(Number(job.requiredConfirmations || requiredConfirmations), 1),
      requiredConfirmations: Number(job.requiredConfirmations || requiredConfirmations),
      observedAt: job.observedAt || now,
      confirmedAt: now,
      lastCheckedAt: now
    };
  }
  return {
    state: 'watching',
    rpcConfigured: true,
    confirmationsObserved: Number(job.confirmationsObserved || 0),
    requiredConfirmations: Number(job.requiredConfirmations || requiredConfirmations),
    lastCheckedAt: now
  };
}
