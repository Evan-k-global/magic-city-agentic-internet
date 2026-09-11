const ACTIVE_CREDIT_RESERVATION_SESSION_STATUSES = new Set([
  'confirmed',
  'queued',
  'claimed',
  'executing'
]);

export function isActiveCreditReservationSessionStatus(value = '') {
  return ACTIVE_CREDIT_RESERVATION_SESSION_STATUSES.has(String(value || '').trim().toLowerCase());
}

export function hasSantaClawzSubmissionEvidence(session = {}) {
  const payment = session?.santaclawzDirectPayment || {};
  const status = String(payment.status || '').trim().toLowerCase();
  return Boolean(
    payment.paymentPayloadDigestSha256
    || payment.hireRequestDigestSha256
    || payment.submittedRequestId
    || payment.submittedAt
    || ['submitting', 'submission_unknown', 'submitted', 'completed'].includes(status)
  );
}

export function assessStaleSantaClawzCreditRestore({
  session = {},
  lock = null,
  requesterHash = '',
  amountUnits = 0,
  creditBacked = false
} = {}) {
  if (!creditBacked) return { ok: false, reason: 'not_credit_backed_santaclawz' };
  if (!lock || lock.status !== 'released') return { ok: false, reason: 'released_lock_required' };
  if (lock.reason !== 'stale_session_lock_released') return { ok: false, reason: 'release_reason_not_restorable' };
  if (!requesterHash || lock.userHash !== requesterHash) return { ok: false, reason: 'credit_lock_requester_mismatch' };
  if (Number(lock.amount || 0) !== Number(amountUnits || 0)) return { ok: false, reason: 'credit_lock_amount_mismatch' };
  if (hasSantaClawzSubmissionEvidence(session)) return { ok: false, reason: 'santaclawz_submission_reconciliation_required' };
  return { ok: true, reason: 'stale_santaclawz_preparation_hold' };
}
