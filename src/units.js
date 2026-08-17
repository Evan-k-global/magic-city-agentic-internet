const CREDIT_SCALE = Number(process.env.CREDIT_SCALE ?? 100);

if (!Number.isFinite(CREDIT_SCALE) || CREDIT_SCALE <= 0 || !Number.isInteger(CREDIT_SCALE)) {
  throw new Error('invalid_CREDIT_SCALE');
}

export { CREDIT_SCALE };

export function toUnits(credits) {
  const n = Number(credits ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * CREDIT_SCALE);
}

export function fromUnits(units) {
  const n = Number(units ?? 0);
  if (!Number.isFinite(n)) return 0;
  return n / CREDIT_SCALE;
}

export function feeFromBps(amountUnits, bps) {
  const a = Math.max(0, Math.trunc(Number(amountUnits ?? 0)));
  const b = Math.max(0, Math.trunc(Number(bps ?? 0)));
  return Math.floor((a * b) / 10000);
}
