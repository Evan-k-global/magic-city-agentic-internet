function clamp(min, max, value) {
  return Math.max(min, Math.min(max, value));
}

export function getBondTier(stakeUnits = 0) {
  if (stakeUnits >= 500 * CREDIT_SCALE) return 3;
  if (stakeUnits >= 200 * CREDIT_SCALE) return 2;
  if (stakeUnits >= 50 * CREDIT_SCALE) return 1;
  return 0;
}

export function computeLaneProfile({ laneId, receipts, stake }) {
  const laneReceipts = receipts.filter((r) => (r.laneId ?? r.capability ?? 'general') === laneId);
  const total = laneReceipts.length;
  const successes = laneReceipts.filter((r) => r.outcome === 'success').length;
  const verified = laneReceipts.filter((r) => r.proofType && r.proofHash).length;
  const disputed = laneReceipts.filter((r) => r.dispute?.status === 'open').length;
  const latencies = laneReceipts
    .map((r) => Number(r.metrics?.latencyMs))
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  const avgLatencyMs = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;

  const successRate = total > 0 ? successes / total : 0;
  const verificationRate = total > 0 ? verified / total : 0;
  const disputeRate = total > 0 ? disputed / total : 0;

  let laneScore = 35;
  laneScore += Math.round(successRate * 35);
  laneScore += Math.round(verificationRate * 20);
  laneScore += avgLatencyMs === null ? 0 : avgLatencyMs <= 1000 ? 8 : avgLatencyMs <= 5000 ? 4 : 1;
  laneScore += Math.min(6, Math.floor(stake / 100));
  laneScore -= Math.min(25, Math.round(disputeRate * 40));
  laneScore = clamp(0, 100, laneScore);

  return {
    laneId,
    score: laneScore,
    totalReceipts: total,
    verifiedReceipts: verified,
    avgLatencyMs,
    disputeRate
  };
}

export function computeLaneProfiles({ agent, receipts, stake }) {
  const lanes = new Set();
  for (const lane of agent.supportedLanes ?? []) lanes.add(String(lane));
  for (const cap of agent.capabilities ?? []) lanes.add(String(cap));
  if (lanes.size === 0) lanes.add('general');

  const profiles = {};
  for (const laneId of lanes) {
    profiles[laneId] = computeLaneProfile({ laneId, receipts, stake });
  }
  return profiles;
}

export function computeReputation({ receipts, attestations, balance, stake }) {
  const total = receipts.length;
  const successes = receipts.filter((r) => r.outcome === 'success').length;
  const failed = receipts.filter((r) => r.outcome === 'failed').length;
  const verified = receipts.filter((r) => r.proofType && r.proofHash).length;
  const settled = receipts.filter((r) => r.settlementRef).length;
  const disputed = receipts.filter((r) => r.dispute?.status === 'open').length;

  const latencies = receipts
    .map((r) => Number(r.metrics?.latencyMs))
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  const avgLatencyMs = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;

  const successRate = total > 0 ? successes / total : 0;
  const verificationRate = total > 0 ? verified / total : 0;
  const settlementRate = total > 0 ? settled / total : 0;

  const trustAttestations = attestations.filter((a) => a.type === 'trust').length;
  const complianceAttestations = attestations.filter((a) => a.type === 'compliance').length;
  const serviceAttestations = attestations.filter((a) =>
    ['service_performance', 'manual_service_attestation', 'human_service_attestation', 'agent_service_attestation', 'acp_service_attestation', 'plugin_fulfillment'].includes(a.type)
  ).length;
  const humanServiceAttestations = attestations.filter((a) => a.metadata?.issuerType === 'human').length;
  const acpServiceAttestations = attestations.filter((a) => a.type === 'acp_service_attestation').length;
  const slashEvents = attestations.filter((a) => a.type === 'slash').length;

  const counterpartyCounts = {};
  for (const r of receipts) {
    if (!r.counterpartyAgentId) continue;
    counterpartyCounts[r.counterpartyAgentId] = (counterpartyCounts[r.counterpartyAgentId] ?? 0) + 1;
  }
  const uniqueCounterparties = Object.keys(counterpartyCounts).length;
  const maxCounterpartyVolume = Math.max(0, ...Object.values(counterpartyCounts));
  const concentrationRatio = total > 0 ? maxCounterpartyVolume / total : 0;
  const selfCounterpartyCount = receipts.filter(
    (r) => r.counterpartyAgentId && r.counterpartyAgentId === r.agentId
  ).length;

  let performanceScore = 45;
  performanceScore += Math.round(successRate * 40);
  performanceScore += avgLatencyMs === null ? 0 : avgLatencyMs <= 1000 ? 10 : avgLatencyMs <= 5000 ? 6 : 2;
  performanceScore += Math.min(8, uniqueCounterparties * 2);
  performanceScore -= Math.min(20, failed * 3);
  if (total >= 5) {
    performanceScore -= concentrationRatio > 0.7 ? 10 : concentrationRatio > 0.5 ? 5 : 0;
    performanceScore -= Math.min(10, selfCounterpartyCount * 2);
  }
  performanceScore = clamp(0, 100, performanceScore);

  let assuranceScore = 40;
  assuranceScore += Math.round(verificationRate * 25);
  assuranceScore += Math.round(settlementRate * 15);
  assuranceScore += Math.min(8, trustAttestations * 2);
  assuranceScore += Math.min(8, complianceAttestations * 2);
  assuranceScore += Math.min(10, serviceAttestations * 2);
  assuranceScore += Math.min(8, humanServiceAttestations * 2);
  assuranceScore += Math.min(8, acpServiceAttestations * 2);
  assuranceScore += Math.min(10, Math.floor((stake ?? 0) / 25));
  assuranceScore -= Math.min(20, disputed * 5);
  assuranceScore -= Math.min(25, slashEvents * 8);
  assuranceScore = clamp(0, 100, assuranceScore);

  const confidence = total >= 25 ? 'high' : total >= 8 ? 'medium' : 'low';
  const score = Math.round(performanceScore * 0.55 + assuranceScore * 0.45);

  return {
    score,
    tracks: {
      performance: performanceScore,
      assurance: assuranceScore
    },
    confidence,
    stats: {
      totalTasks: total,
      successes,
      failed,
      verified,
      settled,
      disputed,
      successRate,
      verificationRate,
      settlementRate,
      avgLatencyMs,
      trustAttestations,
      complianceAttestations,
      serviceAttestations,
      humanServiceAttestations,
      acpServiceAttestations,
      slashEvents,
      uniqueCounterparties,
      concentrationRatio,
      selfCounterpartyCount,
      earnedCredits: balance,
      stakedCredits: stake ?? 0
    }
  };
}
import { CREDIT_SCALE } from './units.js';
