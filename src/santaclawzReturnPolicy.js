const SHA256_HEX = /^[a-f0-9]{64}$/i;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function findSantaClawzReturnEnvelope(payload = {}) {
  const candidates = [
    payload?.protocolReturn,
    payload?.protocol_return,
    payload?.paidExecution?.protocolReturn,
    payload?.paid_execution?.protocol_return,
    payload?.executionState?.protocolReturn,
    payload?.execution_state?.protocol_return,
    payload?.result?.protocolReturn,
    payload?.result?.protocol_return,
    payload
  ];
  return candidates.find((candidate) => isRecord(candidate) && candidate.schema_version === 'santaclawz-return/1.0') || null;
}

export function validateSantaClawzCompletedReturn(payload = {}, { expectedRequestId = '' } = {}) {
  const envelope = findSantaClawzReturnEnvelope(payload);
  if (!envelope) return { ok: false, reason: 'santaclawz_return_missing' };
  if (envelope.status !== 'completed') return { ok: false, reason: 'santaclawz_return_not_completed', envelope };
  if (envelope.agent_private !== true) return { ok: false, reason: 'santaclawz_return_privacy_invalid', envelope };
  const requestId = String(envelope.request_id || '').trim();
  if (!requestId || (expectedRequestId && requestId !== String(expectedRequestId).trim())) {
    return { ok: false, reason: 'santaclawz_return_request_mismatch', envelope };
  }
  const verifiedOutput = isRecord(envelope.verified_output) ? envelope.verified_output : null;
  if (!verifiedOutput) return { ok: false, reason: 'santaclawz_verified_output_missing', envelope };
  if (verifiedOutput.hash_algorithm !== 'sha256' || !SHA256_HEX.test(String(verifiedOutput.package_hash || ''))) {
    return { ok: false, reason: 'santaclawz_package_hash_invalid', envelope };
  }
  const manifest = isRecord(verifiedOutput.verification_manifest) ? verifiedOutput.verification_manifest : null;
  if (
    !manifest
    || !SHA256_HEX.test(String(manifest.input_digest_sha256 || ''))
    || !Array.isArray(manifest.checks_performed)
    || !Array.isArray(manifest.files_produced)
    || !Array.isArray(manifest.blocked_suspicious_instructions)
  ) {
    return { ok: false, reason: 'santaclawz_verification_manifest_invalid', envelope };
  }
  const deliverables = Array.isArray(verifiedOutput.deliverables) ? verifiedOutput.deliverables : [];
  if (!deliverables.length || deliverables.some((entry) => (
    !isRecord(entry)
    || !String(entry.name || '').trim()
    || !SHA256_HEX.test(String(entry.sha256 || ''))
  ))) {
    return { ok: false, reason: 'santaclawz_deliverables_invalid', envelope };
  }
  const buyerVisibleOutputs = Array.isArray(verifiedOutput.buyer_visible_outputs)
    ? verifiedOutput.buyer_visible_outputs
    : [];
  const hasBuyerVisibleOutput = buyerVisibleOutputs.some((entry) => (
    isRecord(entry)
    && Boolean(String(entry.text || '').trim() || SHA256_HEX.test(String(entry.sha256 || '')))
  ));
  const hasDeliverableReference = deliverables.some((entry) => Boolean(String(entry.uri || '').trim()));
  const hasArtifactManifest = /^https:\/\//i.test(String(verifiedOutput.artifact_manifest_url || '').trim());
  if (!hasBuyerVisibleOutput && !hasDeliverableReference && !hasArtifactManifest) {
    return { ok: false, reason: 'santaclawz_buyer_delivery_missing', envelope };
  }
  return {
    ok: true,
    envelope,
    requestId,
    verifiedOutput,
    packageHash: String(verifiedOutput.package_hash).toLowerCase(),
    deliverables,
    buyerVisibleOutputs
  };
}
