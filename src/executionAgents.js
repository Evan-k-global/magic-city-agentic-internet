function clamp(min, max, value) {
  return Math.max(min, Math.min(max, value));
}

function isPositiveAttestation(attestation) {
  const type = String(attestation?.type || '');
  return [
    'plugin_fulfillment',
    'service_performance',
    'manual_service_attestation',
    'human_service_attestation',
    'agent_service_attestation',
    'acp_service_attestation',
    'trust',
    'compliance'
  ].includes(type);
}

function isNegativeAttestation(attestation) {
  const type = String(attestation?.type || '');
  return ['slash', 'service_dispute', 'service_failure_attestation'].includes(type);
}

function matchesExecutionAgent(attestation, pluginId) {
  return (
    attestation?.issuer === pluginId ||
    attestation?.metadata?.pluginId === pluginId ||
    attestation?.metadata?.executionAgentId === pluginId
  );
}

export function computeExecutionAgentScore({ plugin, sessions, attestations }) {
  const relevantSessions = sessions.filter(
    (session) =>
      session?.claimedByPluginId === plugin.pluginId ||
      session?.fulfilledByPluginId === plugin.pluginId ||
      session?.preferredExecutionAgentId === plugin.pluginId
  );
  const fulfilled = relevantSessions.filter((session) => session?.fulfilledByPluginId === plugin.pluginId);
  const claimed = relevantSessions.filter((session) => session?.claimedByPluginId === plugin.pluginId);
  const proofBacked = fulfilled.filter((session) => session?.fulfillment?.proof?.commitmentHash).length;
  const attestationRows = attestations.filter((row) => matchesExecutionAgent(row, plugin.pluginId));
  const positiveAttestations = attestationRows.filter(isPositiveAttestation).length;
  const negativeAttestations = attestationRows.filter(isNegativeAttestation).length;
  const humanAttestations = attestationRows.filter((row) => row?.metadata?.issuerType === 'human').length;
  const acpAttestations = attestationRows.filter((row) => String(row?.type || '').startsWith('acp_')).length;
  const successRate = claimed.length > 0 ? fulfilled.length / claimed.length : fulfilled.length > 0 ? 1 : 0;
  const proofRate = fulfilled.length > 0 ? proofBacked / fulfilled.length : 0;

  let score = 38;
  score += Math.round(successRate * 28);
  score += Math.round(proofRate * 14);
  score += Math.min(10, positiveAttestations * 2);
  score += Math.min(8, humanAttestations * 2);
  score += Math.min(8, acpAttestations * 2);
  score += plugin.localOnly ? 4 : 0;
  score += plugin.metadata?.executionAgent ? 6 : 0;
  score -= Math.min(24, negativeAttestations * 6);
  score = clamp(0, 100, score);

  return {
    pluginId: plugin.pluginId,
    ownerAgentId: plugin.ownerAgentId,
    kind: plugin.kind,
    score,
    stats: {
      fulfilled: fulfilled.length,
      claimed: claimed.length,
      successRate,
      proofBacked,
      proofRate,
      positiveAttestations,
      negativeAttestations,
      humanAttestations,
      acpAttestations
    }
  };
}

export function rankExecutionAgentsForSession({ session, plugins, sessions, attestations }) {
  const kind = session?.handoffData?.kind ?? session?.connectorId ?? null;
  return plugins
    .filter((plugin) => plugin.status === 'active')
    .filter((plugin) => !kind || !plugin.kind || plugin.kind === kind)
    .map((plugin) => ({
      plugin,
      executionScore: computeExecutionAgentScore({ plugin, sessions, attestations })
    }))
    .sort((a, b) => {
      if (b.executionScore.score !== a.executionScore.score) return b.executionScore.score - a.executionScore.score;
      return String(a.plugin.pluginId).localeCompare(String(b.plugin.pluginId));
    });
}
