import crypto from 'node:crypto';

const SHA256_HEX = /^[a-f0-9]{64}$/i;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function artifactResolutionFailure(validation, error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const reason = String(error?.message || '').trim();
  if (statusCode === 409 && /^santaclawz_artifact_manifest_(?:request|name|hash)_mismatch$/.test(reason)) {
    return { ...validation, ok: false, reason };
  }
  if (statusCode === 413) {
    return {
      ...validation,
      ok: false,
      reason: reason || 'santaclawz_deliverable_invalid'
    };
  }
  return {
    ...validation,
    ok: false,
    pending: true,
    retryable: true,
    reason: 'santaclawz_deliverable_temporarily_unavailable'
  };
}

function normalizedManifestFiles(value) {
  if (!Array.isArray(value)) return null;
  const files = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      files.push({ name: entry.trim(), sha256: null });
      continue;
    }
    if (!isRecord(entry) || !String(entry.name || '').trim()) return null;
    const digest = String(entry.sha256 || '').trim().toLowerCase();
    if (digest && !SHA256_HEX.test(digest)) return null;
    files.push({ name: String(entry.name).trim(), sha256: digest || null });
  }
  return files;
}

function normalizedFileHashMap(value) {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value)
    .map(([name, digest]) => [String(name).trim(), String(digest || '').trim().toLowerCase()])
    .filter(([name]) => Boolean(name));
  if (!entries.length || entries.some(([, digest]) => !SHA256_HEX.test(digest))) return null;
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
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

export function validateSantaClawzCompletedReturn(payload = {}, {
  expectedRequestId = '',
  expectedInputDigestSha256 = ''
} = {}) {
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
  const manifestFiles = normalizedManifestFiles(manifest?.files_produced);
  if (
    !manifest
    || !SHA256_HEX.test(String(manifest.input_digest_sha256 || ''))
    || !Array.isArray(manifest.checks_performed)
    || !manifestFiles
    || !Array.isArray(manifest.blocked_suspicious_instructions)
  ) {
    return { ok: false, reason: 'santaclawz_verification_manifest_invalid', envelope };
  }
  if (
    expectedInputDigestSha256
    && String(manifest.input_digest_sha256).toLowerCase() !== String(expectedInputDigestSha256).trim().toLowerCase()
  ) {
    return { ok: false, reason: 'santaclawz_return_input_mismatch', envelope };
  }
  const deliverables = Array.isArray(verifiedOutput.deliverables) ? verifiedOutput.deliverables : [];
  if (!deliverables.length || deliverables.some((entry) => (
    !isRecord(entry)
    || !String(entry.name || '').trim()
    || !SHA256_HEX.test(String(entry.sha256 || ''))
  ))) {
    return { ok: false, reason: 'santaclawz_deliverables_invalid', envelope };
  }
  const deliverableByName = new Map(deliverables.map((entry) => [
    String(entry.name).trim(),
    String(entry.sha256).trim().toLowerCase()
  ]));
  if (
    deliverableByName.size !== deliverables.length
    || new Set(manifestFiles.map((entry) => entry.name)).size !== manifestFiles.length
    || manifestFiles.length !== deliverables.length
    || manifestFiles.some((entry) => (
      !deliverableByName.has(entry.name)
      || (entry.sha256 && deliverableByName.get(entry.name) !== entry.sha256)
    ))
  ) {
    return { ok: false, reason: 'santaclawz_manifest_deliverables_mismatch', envelope };
  }
  if (manifest.request_id && String(manifest.request_id).trim() !== requestId) {
    return { ok: false, reason: 'santaclawz_manifest_request_mismatch', envelope };
  }
  const declaredManifestPackageHash = String(manifest.package_hash || '').trim().toLowerCase();
  if (declaredManifestPackageHash && declaredManifestPackageHash !== String(verifiedOutput.package_hash).toLowerCase()) {
    return { ok: false, reason: 'santaclawz_manifest_package_mismatch', envelope };
  }
  const manifestFileHashes = normalizedFileHashMap(manifest.file_hashes);
  if (manifest.file_hashes != null && !manifestFileHashes) {
    return { ok: false, reason: 'santaclawz_manifest_file_hashes_invalid', envelope };
  }
  if (manifestFileHashes) {
    const expectedFileHashes = Object.fromEntries(
      [...deliverableByName.entries()].sort(([left], [right]) => left.localeCompare(right))
    );
    if (JSON.stringify(manifestFileHashes) !== JSON.stringify(expectedFileHashes)) {
      return { ok: false, reason: 'santaclawz_manifest_file_hashes_mismatch', envelope };
    }
    const fileHashEntries = Object.entries(manifestFileHashes);
    const packageHashCandidates = new Set([
      sha256Hex(Buffer.from(JSON.stringify(manifestFileHashes), 'utf8')),
      sha256Hex(Buffer.from(`{${fileHashEntries.map(([name, digest]) => `${JSON.stringify(name)}: ${JSON.stringify(digest)}`).join(', ')}}`, 'utf8'))
    ]);
    if (!packageHashCandidates.has(String(verifiedOutput.package_hash).toLowerCase())) {
      return { ok: false, reason: 'santaclawz_package_hash_mismatch', envelope };
    }
  }
  const buyerVisibleOutputs = Array.isArray(verifiedOutput.buyer_visible_outputs)
    ? verifiedOutput.buyer_visible_outputs
    : [];
  const verifiedInlineOutputs = [];
  for (const entry of buyerVisibleOutputs) {
    if (!isRecord(entry) || !String(entry.text || '').trim()) continue;
    const name = String(entry.name || '').trim();
    const declaredHash = String(entry.sha256 || '').trim().toLowerCase();
    if (!name || !SHA256_HEX.test(declaredHash)) {
      return { ok: false, reason: 'santaclawz_inline_output_hash_missing', envelope };
    }
    const actualHash = sha256Hex(Buffer.from(String(entry.text), 'utf8'));
    if (actualHash !== declaredHash || deliverableByName.get(name) !== declaredHash) {
      return { ok: false, reason: 'santaclawz_inline_output_hash_mismatch', envelope };
    }
    verifiedInlineOutputs.push({ name, sha256: actualHash, bytes: Buffer.byteLength(String(entry.text), 'utf8') });
  }
  const hasBuyerVisibleOutput = verifiedInlineOutputs.length > 0;
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
    buyerVisibleOutputs,
    verifiedInlineOutputs,
    packageHashVerified: Boolean(manifestFileHashes)
  };
}

function validateSantaClawzDirectOutputProjection(payload = {}, {
  expectedRequestId = '',
  expectedInputDigestSha256 = ''
} = {}) {
  const executionState = isRecord(payload?.executionState) ? payload.executionState : null;
  const verifiedOutput = isRecord(executionState?.delivery?.protocolVerifiedOutput)
    ? executionState.delivery.protocolVerifiedOutput
    : null;
  if (!executionState || !verifiedOutput) return { ok: false, reason: 'santaclawz_return_missing' };

  const requestId = String(executionState.requestId || executionState.ids?.executionRequestId || '').trim();
  if (!requestId || (expectedRequestId && requestId !== String(expectedRequestId).trim())) {
    return { ok: false, reason: 'santaclawz_return_request_mismatch' };
  }
  if (executionState.stateAccess?.mode !== 'payment_digest_recovery') {
    return { ok: false, reason: 'santaclawz_direct_output_auth_invalid' };
  }
  if (
    String(executionState.currentPhase || '').toLowerCase() !== 'return_verified'
    || String(executionState.lifecycle?.proofStatus || '').toLowerCase() !== 'return_validated'
  ) {
    return { ok: false, reason: 'santaclawz_return_not_completed' };
  }

  const packageHash = String(verifiedOutput.packageHash || '').trim().toLowerCase();
  const inputDigestSha256 = String(verifiedOutput.inputDigestSha256 || '').trim().toLowerCase();
  const outputBundleDigestSha256 = String(verifiedOutput.buyerOutputBundleDigestSha256 || '').trim().toLowerCase();
  if (!SHA256_HEX.test(packageHash) || verifiedOutput.packageHashVerified !== true) {
    return { ok: false, reason: 'santaclawz_package_hash_unverifiable' };
  }
  if (!SHA256_HEX.test(inputDigestSha256)) {
    return { ok: false, reason: 'santaclawz_verification_manifest_invalid' };
  }
  if (
    expectedInputDigestSha256
    && inputDigestSha256 !== String(expectedInputDigestSha256).trim().toLowerCase()
  ) {
    return { ok: false, reason: 'santaclawz_return_input_mismatch' };
  }
  if (!SHA256_HEX.test(outputBundleDigestSha256)) {
    return { ok: false, reason: 'santaclawz_output_bundle_hash_invalid' };
  }

  const outputs = Array.isArray(verifiedOutput.buyerVisibleOutputs)
    ? verifiedOutput.buyerVisibleOutputs
    : [];
  const verifiedInlineOutputs = [];
  const outputHashes = {};
  for (const entry of outputs) {
    if (!isRecord(entry)) return { ok: false, reason: 'santaclawz_inline_output_invalid' };
    const name = String(entry.name || '').trim();
    const text = typeof entry.text === 'string' ? entry.text : '';
    const declaredHash = String(entry.sha256 || '').trim().toLowerCase();
    if (!name || !text || !SHA256_HEX.test(declaredHash) || outputHashes[name]) {
      return { ok: false, reason: 'santaclawz_inline_output_hash_missing' };
    }
    const actualHash = sha256Hex(Buffer.from(text, 'utf8'));
    if (actualHash !== declaredHash) {
      return { ok: false, reason: 'santaclawz_inline_output_hash_mismatch' };
    }
    if (/\.json$/i.test(name)) {
      try {
        JSON.parse(text);
      } catch {
        return { ok: false, reason: 'santaclawz_inline_json_invalid' };
      }
    }
    outputHashes[name] = actualHash;
    verifiedInlineOutputs.push({ name, sha256: actualHash, bytes: Buffer.byteLength(text, 'utf8') });
  }
  if (!verifiedInlineOutputs.some((entry) => /\.md$/i.test(entry.name))
    || !verifiedInlineOutputs.some((entry) => /\.json$/i.test(entry.name))) {
    return { ok: false, reason: 'santaclawz_buyer_delivery_missing' };
  }
  const normalizedHashes = Object.fromEntries(
    Object.entries(outputHashes).sort(([left], [right]) => left.localeCompare(right))
  );
  if (sha256Hex(Buffer.from(JSON.stringify(normalizedHashes), 'utf8')) !== outputBundleDigestSha256) {
    return { ok: false, reason: 'santaclawz_output_bundle_hash_mismatch' };
  }

  return {
    ok: true,
    mode: 'authenticated_direct_output',
    requestId,
    packageHash,
    packageHashVerified: true,
    verifiedOutput,
    buyerVisibleOutputs: outputs,
    verifiedInlineOutputs,
    deliverables: outputs.map((entry) => ({
      name: String(entry.name).trim(),
      sha256: String(entry.sha256).trim().toLowerCase()
    }))
  };
}

export async function verifySantaClawzCompletedReturn(payload = {}, {
  expectedRequestId = '',
  expectedInputDigestSha256 = '',
  resolveArtifactBytes = null
} = {}) {
  let validation = validateSantaClawzCompletedReturn(payload, {
    expectedRequestId,
    expectedInputDigestSha256
  });
  if (!validation.ok && validation.reason === 'santaclawz_return_missing') {
    validation = validateSantaClawzDirectOutputProjection(payload, {
      expectedRequestId,
      expectedInputDigestSha256
    });
  }
  if (!validation.ok) return validation;
  if (validation.mode === 'authenticated_direct_output') {
    return {
      ...validation,
      verifiedDeliverableCount: validation.verifiedInlineOutputs.length
    };
  }
  const manifestRequestId = String(validation.verifiedOutput.verification_manifest?.request_id || '').trim();
  if (!manifestRequestId || manifestRequestId !== validation.requestId) {
    return { ...validation, ok: false, reason: 'santaclawz_manifest_request_mismatch' };
  }

  const verifiedNames = new Set(validation.verifiedInlineOutputs.map((entry) => entry.name));
  for (const deliverable of validation.deliverables) {
    const name = String(deliverable.name).trim();
    if (verifiedNames.has(name)) continue;
    if (typeof resolveArtifactBytes !== 'function') {
      return {
        ...validation,
        ok: false,
        pending: true,
        retryable: true,
        reason: 'santaclawz_deliverable_verification_pending'
      };
    }
    let resolved;
    try {
      resolved = await resolveArtifactBytes({
        deliverable,
        artifactManifestUrl: String(validation.verifiedOutput.artifact_manifest_url || '').trim(),
        requestId: validation.requestId
      });
    } catch (error) {
      return artifactResolutionFailure(validation, error);
    }
    const bytes = Buffer.isBuffer(resolved?.bytes)
      ? resolved.bytes
      : resolved?.bytes instanceof Uint8Array
        ? Buffer.from(resolved.bytes)
        : null;
    if (!bytes?.length) {
      return { ...validation, ok: false, reason: 'santaclawz_deliverable_bytes_unavailable' };
    }
    const actualHash = sha256Hex(bytes);
    if (actualHash !== String(deliverable.sha256).toLowerCase()) {
      return { ...validation, ok: false, reason: 'santaclawz_deliverable_hash_mismatch' };
    }
    verifiedNames.add(name);
  }

  if (verifiedNames.size !== validation.deliverables.length) {
    return { ...validation, ok: false, reason: 'santaclawz_deliverable_bytes_unavailable' };
  }
  if (!validation.packageHashVerified) {
    return { ...validation, ok: false, reason: 'santaclawz_package_hash_unverifiable' };
  }
  return {
    ...validation,
    verifiedDeliverableCount: verifiedNames.size
  };
}
