export const PAYMENT_AUTHORIZATION_MODES = {
  CREDIT_TOPUP: 'credit_topup',
  DIRECT_PAYMENT: 'direct_payment'
};

export const PAYMENT_AUTHORIZATION_STAGES = {
  REQUESTED: 'requested',
  SUBMITTED: 'submitted',
  OBSERVED: 'observed',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  SHADOW_RELAYER_PLANNED: 'shadow_relayer_planned',
  SHADOW_RELAYER_SIMULATED: 'shadow_relayer_simulated'
};

function normalizeMode(mode) {
  return String(mode || '').trim() === PAYMENT_AUTHORIZATION_MODES.CREDIT_TOPUP
    ? PAYMENT_AUTHORIZATION_MODES.CREDIT_TOPUP
    : PAYMENT_AUTHORIZATION_MODES.DIRECT_PAYMENT;
}

function normalizeStage(stage) {
  const normalized = String(stage || '').trim().toLowerCase();
  return Object.values(PAYMENT_AUTHORIZATION_STAGES).includes(normalized)
    ? normalized
    : PAYMENT_AUTHORIZATION_STAGES.REQUESTED;
}

export function buildPaymentAuthorizationStatementKind({ mode = PAYMENT_AUTHORIZATION_MODES.DIRECT_PAYMENT, stage = PAYMENT_AUTHORIZATION_STAGES.REQUESTED } = {}) {
  const normalizedMode = normalizeMode(mode);
  const normalizedStage = normalizeStage(stage);
  if (normalizedStage.startsWith('shadow_relayer_')) {
    return `payment_authorization:${normalizedStage}`;
  }
  const prefix =
    normalizedMode === PAYMENT_AUTHORIZATION_MODES.CREDIT_TOPUP
      ? 'user_wallet_topup'
      : 'direct_payment';
  return `payment_authorization:${prefix}_${normalizedStage}`;
}

export function isPaymentAuthorizationStatementKind(value) {
  return /^payment_authorization:/i.test(String(value || '').trim());
}
