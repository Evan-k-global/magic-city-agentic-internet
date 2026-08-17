import crypto from 'node:crypto';

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

export function buildReceiptSignPayload(receiptLike) {
  const payload = {
    agentId: receiptLike.agentId ?? null,
    counterpartyAgentId: receiptLike.counterpartyAgentId ?? null,
    taskId: receiptLike.taskId ?? null,
    intentId: receiptLike.intentId ?? null,
    requestHash: receiptLike.requestHash ?? null,
    outputHash: receiptLike.outputHash ?? null,
    outcome: receiptLike.outcome ?? null,
    proofType: receiptLike.proofType ?? null,
    proofHash: receiptLike.proofHash ?? null,
    settlementRef: receiptLike.settlementRef ?? null,
    payment: receiptLike.payment ?? null
  };
  return canonicalize(payload);
}

function getPublicKeyObject(agent) {
  const signing = agent?.signing ?? {};
  if (signing.publicKeyPem) {
    return crypto.createPublicKey(signing.publicKeyPem);
  }
  if (signing.publicKeyJwk) {
    return crypto.createPublicKey({ key: signing.publicKeyJwk, format: 'jwk' });
  }
  return null;
}

export function verifyReceiptSignature({ agent, receiptLike, signature }) {
  if (!signature?.value) {
    return { ok: false, reason: 'missing_signature' };
  }

  const keyObject = getPublicKeyObject(agent);
  if (!keyObject) {
    return { ok: false, reason: 'agent_signing_key_not_configured' };
  }

  const scheme = signature.scheme ?? agent.signing?.scheme ?? 'ed25519';
  if (scheme !== 'ed25519') {
    return { ok: false, reason: 'unsupported_signature_scheme' };
  }

  try {
    const message = buildReceiptSignPayload(receiptLike);
    const sigBytes = Buffer.from(signature.value, 'base64');
    const ok = crypto.verify(null, Buffer.from(message, 'utf8'), keyObject, sigBytes);
    return ok ? { ok: true } : { ok: false, reason: 'invalid_signature' };
  } catch {
    return { ok: false, reason: 'signature_verification_error' };
  }
}
