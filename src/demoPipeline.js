import crypto from 'node:crypto';

const BASE_URL = process.env.AGENT_VERIFICATION_BASE_URL || 'http://127.0.0.1:4411';

function hashHex(input) {
  return `0x${crypto.createHash('sha256').update(input).digest('hex')}`;
}

async function request(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`${method} ${path} failed: ${JSON.stringify(data)}`);
  }
  return data;
}

async function registerAgent(agentId, capabilities) {
  return request('POST', '/agents/register', {
    agentId,
    owner: 'demo-pipeline',
    publicKey: `B62q${agentId}`,
    capabilities,
    supportedLanes: capabilities,
    pricingModel: { basePrice: 1, unit: 'credits' },
    metadata: { demo: true }
  });
}

async function routeIntent(requesterAgentId, capability, budget, inputHash, workflowId) {
  return request('POST', '/intent', {
    requesterAgentId,
    capability,
    budget,
    minLaneScore: 0,
    minBondTier: 1,
    privacyMode: 'private',
    inputHash,
    metadata: { workflowId }
  });
}

async function createReceipt(payload) {
  return request('POST', '/receipts', payload);
}

async function run() {
  await request('GET', '/health');

  const suffix = Date.now().toString().slice(-6);
  const workflowId = `wf-${suffix}`;

  const orchestrator = `orchestrator-${suffix}`;
  const research = `research-${suffix}`;
  const analysis = `analysis-${suffix}`;
  const execution = `execution-${suffix}`;

  await registerAgent(orchestrator, ['orchestration']);
  await registerAgent(research, ['research', 'financial-analysis']);
  await registerAgent(analysis, ['analysis', 'risk-scoring']);
  await registerAgent(execution, ['execution', 'trade-execution']);

  await request('POST', '/faucet/request', { agentId: research });
  await request('POST', '/faucet/request', { agentId: analysis });
  await request('POST', '/faucet/request', { agentId: execution });
  await request('POST', `/agents/${research}/stake`, { amount: 60 });
  await request('POST', `/agents/${analysis}/stake`, { amount: 60 });
  await request('POST', `/agents/${execution}/stake`, { amount: 60 });

  const seedInput = 'Build long/short daily plan for liquid equities';
  const inputHash0 = hashHex(seedInput);

  const i1 = await routeIntent(orchestrator, 'financial-analysis', 1, inputHash0, workflowId);
  const selected1 = i1.selectedAgent.agentId;
  const outputHash1 = hashHex(`${workflowId}:research:signals`);
  const r1 = await createReceipt({
    agentId: selected1,
    counterpartyAgentId: orchestrator,
    taskId: `${workflowId}-step-1`,
    intentId: i1.intent.id,
    requestHash: inputHash0,
    outputHash: outputHash1,
    laneId: 'financial-analysis',
    outcome: 'success',
    proofType: 'acp-attestation',
    proofHash: hashHex(`${workflowId}:proof:1`),
    verifier: 'demo-oracle',
    settlementRef: `zeko:testnet:${workflowId}:1`,
    payment: { mode: 'credits', amount: 1 },
    metrics: { latencyMs: 850 },
    metadata: { workflowId, step: 1, stage: 'research' }
  });

  const i2 = await routeIntent(orchestrator, 'analysis', 1, outputHash1, workflowId);
  const selected2 = i2.selectedAgent.agentId;
  const outputHash2 = hashHex(`${workflowId}:analysis:risk-bands`);
  const r2 = await createReceipt({
    agentId: selected2,
    counterpartyAgentId: orchestrator,
    taskId: `${workflowId}-step-2`,
    intentId: i2.intent.id,
    requestHash: outputHash1,
    outputHash: outputHash2,
    laneId: 'analysis',
    outcome: 'success',
    proofType: 'tlsnotary',
    proofHash: hashHex(`${workflowId}:proof:2`),
    verifier: 'tlsn-v1',
    settlementRef: `zeko:testnet:${workflowId}:2`,
    payment: { mode: 'credits', amount: 1 },
    metrics: { latencyMs: 1230 },
    metadata: { workflowId, step: 2, stage: 'analysis', prevReceiptId: r1.receipt.id }
  });

  const i3 = await routeIntent(orchestrator, 'trade-execution', 1, outputHash2, workflowId);
  const selected3 = i3.selectedAgent.agentId;
  const outputHash3 = hashHex(`${workflowId}:execution:orders`);
  const r3 = await createReceipt({
    agentId: selected3,
    counterpartyAgentId: orchestrator,
    taskId: `${workflowId}-step-3`,
    intentId: i3.intent.id,
    requestHash: outputHash2,
    outputHash: outputHash3,
    laneId: 'trade-execution',
    outcome: 'success',
    proofType: 'acp-attestation',
    proofHash: hashHex(`${workflowId}:proof:3`),
    verifier: 'demo-oracle',
    settlementRef: `zeko:testnet:${workflowId}:3`,
    payment: { mode: 'credits', amount: 1 },
    metrics: { latencyMs: 640 },
    metadata: { workflowId, step: 3, stage: 'execution', prevReceiptId: r2.receipt.id }
  });

  const leaderboard = await request('GET', '/leaderboard');

  const summary = {
    workflowId,
    chain: [
      { step: 1, agentId: selected1, intentId: i1.intent.id, receiptId: r1.receipt.id, requestHash: inputHash0, outputHash: outputHash1 },
      { step: 2, agentId: selected2, intentId: i2.intent.id, receiptId: r2.receipt.id, requestHash: outputHash1, outputHash: outputHash2 },
      { step: 3, agentId: selected3, intentId: i3.intent.id, receiptId: r3.receipt.id, requestHash: outputHash2, outputHash: outputHash3 }
    ],
    topLeaderboard: leaderboard.leaderboard.slice(0, 5).map((x) => ({
      agentId: x.agentId,
      score: x.reputation.score,
      performance: x.reputation.tracks.performance,
      assurance: x.reputation.tracks.assurance
    }))
  };

  console.log(JSON.stringify(summary, null, 2));
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
