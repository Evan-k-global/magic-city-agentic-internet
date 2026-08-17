function titleize(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function compactObject(obj = {}) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

function uniqueTargets(targets = []) {
  const seen = new Set();
  return targets.filter((target) => {
    const url = String(target?.url || '');
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

export function shouldProcessExecutionSession(session, { kind, pluginId, pluginAliases = [] }) {
  if (!session || session.handoffData?.kind !== kind) return false;
  if (!['queued', 'confirmed', 'claimed', 'executing'].includes(session.status)) return false;
  if (session.completionMode !== 'agent_checkout') return false;
  const acceptedPluginIds = new Set([pluginId, ...pluginAliases].filter(Boolean));
  if (session.preferredExecutionAgentId && !acceptedPluginIds.has(session.preferredExecutionAgentId)) return false;
  if (session.claimedByPluginId && session.claimedByPluginId !== pluginId) return false;
  return true;
}

export function buildExecutionTargets(session) {
  const payment = session?.paymentOrchestration || {};
  const handoff = session?.handoffData || {};
  const squareUrl = session?.squarePaymentLink?.url || null;
  const resolvedUrl = session?.resolvedOrderUrl || null;
  const fulfillmentUrl = session?.fulfillment?.handoff?.url || null;
  const providerLinks = Array.isArray(handoff.providerLinks) ? handoff.providerLinks : [];
  const reservationLinks = Array.isArray(payment.reservationLinks) ? payment.reservationLinks : [];

  return uniqueTargets([
    squareUrl
      ? {
          type: 'payment',
          label: 'Magic City Square checkout',
          url: squareUrl,
          provider: 'square',
          preferred: true
        }
      : null,
    resolvedUrl
      ? {
          type: 'provider',
          label: payment.restaurantName ? `Provider page for ${payment.restaurantName}` : 'Resolved provider page',
          url: resolvedUrl,
          provider: payment.orderProvider || payment.provider || session?.resolvedOrderProvider || 'provider',
          preferred: !squareUrl
        }
      : null,
    fulfillmentUrl
      ? {
          type: 'handoff',
          label: session?.fulfillment?.handoff?.label || 'Execution handoff',
          url: fulfillmentUrl,
          provider: 'magic_city',
          preferred: false
        }
      : null,
    ...providerLinks.map((link) => ({
      type: 'provider',
      label: link.label || 'Provider link',
      url: link.url,
      provider: link.provider || 'provider',
      preferred: Boolean(link.preferredForExecution) && !squareUrl && !resolvedUrl
    })),
    ...reservationLinks.map((link) => ({
      type: 'reservation',
      label: link.label || 'Reservation link',
      url: link.url,
      provider: link.provider || 'reservation',
      preferred: Boolean(link.preferredForExecution) && !squareUrl && !resolvedUrl
    }))
  ]);
}

export function buildExecutionTaskPackage(session) {
  const kind = session?.handoffData?.kind || null;
  const localContext = session?.localContext || {};
  const finalSelections = session?.finalSelections || session?.selections || {};
  const payment = session?.paymentOrchestration || null;
  const requesterAgent = session?.personalAgentProfile || session?.profileSummary?.personalAgent || null;
  const targets = buildExecutionTargets(session);
  const preferredTarget = targets.find((target) => target.preferred) || targets[0] || null;
  return {
    schema: 'magic-city-task-package-v1',
    sessionId: session?.id || null,
    connectorId: session?.connectorId || null,
    kind,
    status: session?.status || 'ready',
    completionMode: session?.completionMode || null,
    title: session?.handoffData?.title || null,
    subtitle: session?.handoffData?.subtitle || null,
    summary: session?.actionSummary || null,
    helperAgents: session?.handoffData?.helperAgents || [],
    selections: compactObject(finalSelections),
    localContext: compactObject(localContext),
    requesterAgent: requesterAgent
      ? compactObject({
          enabled: requesterAgent.enabled,
          name: requesterAgent.name,
          agentId: requesterAgent.agentId,
          runtime: requesterAgent.runtime,
          runtimeLabel: requesterAgent.runtimeLabel,
          runtimeEndpoint: requesterAgent.runtimeEndpoint,
          fundingSource: requesterAgent.fundingSource,
          fundingSourceLabel: requesterAgent.fundingSourceLabel,
          autonomyMode: requesterAgent.autonomyMode,
          autonomyLabel: requesterAgent.autonomyLabel,
          walletBudgetCredits: requesterAgent.walletBudgetCredits,
          perTaskCapCredits: requesterAgent.perTaskCapCredits,
          dailyCapCredits: requesterAgent.dailyCapCredits,
          marketplaceReserveCredits: requesterAgent.marketplaceReserveCredits,
          magicCityMcpEndpoint: requesterAgent.magicCityMcpEndpoint,
          allowCredits: requesterAgent.policy?.allowCredits,
          allowAccounts: requesterAgent.policy?.allowAccounts,
          allowWallet: requesterAgent.policy?.allowWallet,
          allowMarketplace: requesterAgent.policy?.allowMarketplace,
          requireReview: requesterAgent.policy?.requireReview
        })
      : null,
    localPrivateSummary: compactObject(session?.localPrivateSummary || {}),
    localPrivateHashes: compactObject(session?.localPrivateHashes || {}),
    agentProtocol: compactObject(session?.agentProtocol || {}),
    missionContract: compactObject(session?.missionContract || session?.missionBoundAuth?.missionContract || {}),
    missionCommitments: compactObject({
      missionContractHash:
        session?.missionContractHash ||
        session?.missionBoundAuth?.missionContractHash ||
        session?.missionBoundExecution?.missionContractHash,
      checkpointTranscriptHash:
        session?.checkpointTranscriptHash ||
        session?.missionBoundExecution?.checkpointTranscriptHash,
      checkpointLatestHash:
        session?.missionBoundaryLatestHash ||
        session?.missionBoundExecution?.checkpointLatestHash,
      checkpointCount: Array.isArray(session?.missionBoundaryTrace)
        ? session.missionBoundaryTrace.length
        : session?.missionBoundExecution?.checkpointCount,
      resultHash: session?.missionBoundExecution?.resultHash
    }),
    funding: payment
      ? compactObject({
          provider: payment.provider,
          orderProvider: payment.orderProvider,
          providerLabel: payment.providerLabel,
          orderProviderLabel: payment.orderProviderLabel,
          fundingMode: payment.fundingMode,
          checkoutLabel: payment.checkoutLabel,
          restaurantName: payment.restaurantName,
          taskName: payment.taskName,
          serviceTier: payment.serviceTier,
          rowCountBand: payment.rowCountBand,
          lengthBand: payment.lengthBand,
          serviceSurface: payment.serviceSurface,
          travelMode: payment.travelMode,
          checkoutFundingRail: payment.checkoutFundingRail,
          checkoutFundingNetworkKey: payment.checkoutFundingNetworkKey,
          checkoutFundingCredits: payment.checkoutFundingCredits,
          checkoutFundingUsd: payment.checkoutFundingUsd,
          serviceRequiredCredits: payment.serviceRequiredCredits,
          estimatedTripUsd: payment.estimatedTripUsd,
          costUsd: payment.costUsd,
          subtotalUsd: payment.subtotalUsd,
          platformFeeUsd: payment.platformFeeUsd,
          feePercentLabel: payment.feePercentLabel,
          merchantPassThroughUsd: payment.merchantPassThroughUsd,
          requiredCredits: payment.requiredCredits,
          pricingMode: payment.pricingMode,
          pricingPhase: payment.pricingPhase,
          pricingLabel: payment.pricingLabel,
          merchantSettlementMode: payment.merchantSettlementMode,
          source: payment.source,
          sourceDisplay: payment.sourceDisplay
        })
      : null,
    targets,
    preferredTarget,
    humanActionLabel: session?.handoffData?.humanActionLabel || 'Finish checkout myself',
    agentActionLabel: session?.handoffData?.agentActionLabel || 'Let an agent complete this'
  };
}

export function buildExecutionResult({
  session,
  completionState,
  nextHumanAction,
  artifacts = [],
  extraResult = {}
}) {
  const taskPackage = buildExecutionTaskPackage(session);
  return {
    ...extraResult,
    completionState,
    nextHumanAction,
    artifacts,
    taskPackage
  };
}

export function describeCompletionState(kind, completionState, nextHumanAction = '') {
  const lane = titleize(kind || 'task');
  if (completionState === 'completed') return `${lane} execution completed.`;
  if (completionState === 'needs_user_payment') return `${lane} execution is ready for payment. ${nextHumanAction}`.trim();
  if (completionState === 'needs_user_confirmation') return `${lane} execution is ready for final confirmation. ${nextHumanAction}`.trim();
  if (completionState === 'needs_local_runner') return `${lane} execution needs the local browser runner. ${nextHumanAction}`.trim();
  if (completionState === 'ready_for_review') return `${lane} execution is ready for review. ${nextHumanAction}`.trim();
  if (completionState === 'failed') return `${lane} execution failed. ${nextHumanAction}`.trim();
  return `${lane} execution updated. ${nextHumanAction}`.trim();
}
