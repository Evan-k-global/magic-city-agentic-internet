import assert from 'node:assert/strict';
import {
  isSantaClawzAvailableForMagicCity,
  isSantaClawzHireReadyForMagicCity,
  isSantaClawzVisibleForMagicCityMarketplace,
  isRetiredSantaClawzAgent
} from '../src/santaclawzAgentProvider.js';

const hostedCodeAudit = {
  agentId: 'hosted-code-audit-agent--session_agent_0e86fd7829bd',
  agentName: 'Code Audit Agent',
  headline: 'LLM-backed code audit agent that reviews submitted code.',
  availability: 'active',
  online: true,
  published: true,
  hireable: true,
  paymentsReady: true,
  paidExecutionReady: true,
  paidExecutionProven: true,
  pricing: {
    paidJobsEnabled: true,
    paymentProfileReady: true,
    payoutAddressConfigured: true
  },
  readiness: {
    online: true,
    paidExecutionReady: true,
    paidExecutionProven: true,
    relayConnected: true,
    heartbeatLive: true,
    runtimeReachable: true,
    workerReachable: true
  }
};

const localhostLookalike = {
  ...hostedCodeAudit,
  agentId: 'code-audit-agent--session_agent_51a8f5e04659',
  agentName: 'code audit agent (localhost)',
  publicAgentUrl: 'https://santaclawz.ai/agent/code-audit-agent--session_agent_51a8f5e04659',
  publicHireUrl: 'https://santaclawz.ai/agent/code-audit-agent--session_agent_51a8f5e04659/hire'
};

const publishedButOffline = {
  agentId: 'pitch-deck-review-agent--session_agent_0c8dddb871f1',
  agentName: 'Pitch Deck Review Agent',
  headline: 'Published marketplace page with payments configured, but no live runtime.',
  availability: 'active',
  online: false,
  published: true,
  hireable: false,
  paymentsReady: true,
  paidExecutionReady: false,
  paidExecutionProven: false,
  publicAgentUrl: 'https://santaclawz.ai/agent/pitch-deck-review-agent--session_agent_0c8dddb871f1',
  publicHireUrl: 'https://santaclawz.ai/agent/pitch-deck-review-agent--session_agent_0c8dddb871f1/hire',
  pricing: {
    paidJobsEnabled: true,
    paymentProfileReady: true,
    payoutAddressConfigured: true
  },
  readiness: {
    online: false,
    relayConnected: false,
    heartbeatLive: false,
    runtimeReachable: false,
    workerReachable: false
  }
};

const onlineQuoteAgent = {
  agentId: 'mini-agent-commerce-scout--session_agent_0505a8c61c2a',
  agentName: 'Mini Agent Commerce Scout',
  availability: 'active',
  online: true,
  published: true,
  hireable: true,
  paymentsReady: true,
  quoteReady: true,
  paidExecutionReady: false,
  paidExecutionProven: true,
  readiness: {
    online: true,
    quoteReady: true,
    relayConnected: true,
    heartbeatLive: true,
    runtimeReachable: true,
    workerReachable: true
  }
};

const onboardingPlaceholder = {
  agentId: 'agent-x44--session_agent_f4a439330829',
  agentName: 'Agent_X44',
  headline: 'Agent_X44 is onboarding on SantaClawz. Other agents can ping it for current scope, pricing, and availability updates.',
  availability: 'active',
  online: true,
  published: true,
  hireable: true,
  paymentsReady: true,
  paidExecutionReady: true,
  pricing: {
    paidJobsEnabled: true,
    paymentProfileReady: true,
    payoutAddressConfigured: true
  }
};

const genericProtocolExplainer = {
  agentId: 'anonai--session_agent_fbce028e4209',
  agentName: 'Anonai',
  headline: '1. Perceive / Take Input\nThe agent gathers info from its environment. This can come from: user prompt, files/data, tools/APIs, context.',
  availability: 'active',
  online: true,
  published: true,
  hireable: true,
  quoteReady: true,
  paymentsReady: true
};

assert.equal(isSantaClawzAvailableForMagicCity(hostedCodeAudit), true);
assert.equal(isSantaClawzHireReadyForMagicCity(hostedCodeAudit), true);
assert.equal(isSantaClawzVisibleForMagicCityMarketplace(hostedCodeAudit), true);

assert.equal(isSantaClawzAvailableForMagicCity(localhostLookalike), false);
assert.equal(isSantaClawzHireReadyForMagicCity(localhostLookalike), false);
assert.equal(isSantaClawzVisibleForMagicCityMarketplace(localhostLookalike), false);

assert.equal(isSantaClawzAvailableForMagicCity(publishedButOffline), false);
assert.equal(isSantaClawzHireReadyForMagicCity(publishedButOffline), false);
assert.equal(isSantaClawzVisibleForMagicCityMarketplace(publishedButOffline), false);

assert.equal(isSantaClawzAvailableForMagicCity(onlineQuoteAgent), true);
assert.equal(isSantaClawzHireReadyForMagicCity(onlineQuoteAgent), true);
assert.equal(isSantaClawzVisibleForMagicCityMarketplace(onlineQuoteAgent), true);

assert.equal(isSantaClawzHireReadyForMagicCity(onboardingPlaceholder), false);
assert.equal(isSantaClawzVisibleForMagicCityMarketplace(onboardingPlaceholder), false);

assert.equal(isSantaClawzHireReadyForMagicCity(genericProtocolExplainer), false);
assert.equal(isSantaClawzVisibleForMagicCityMarketplace(genericProtocolExplainer), false);
assert.equal(isRetiredSantaClawzAgent(publishedButOffline), true);
assert.equal(isRetiredSantaClawzAgent({ agentId: 'santaclawz:pitch-deck-review-agent--session_agent_old' }), true);
assert.equal(isRetiredSantaClawzAgent(hostedCodeAudit), false);

console.log('santaclawz agent eligibility regression passed');
