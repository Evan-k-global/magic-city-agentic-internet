import crypto from 'node:crypto';

export const NAVA_DEFAULT_CHAIN_ID = 11155111;
export const NAVA_AUDIT_NETWORK = 'zeko:testnet';
export const NAVA_SERVICE_VERSION = 'nava-zeko-compat-v1';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const SELECTOR_LABELS = {
  '0x': 'native-transfer',
  '0xa9059cbb': 'erc20-transfer',
  '0x095ea7b3': 'erc20-approve',
  '0x23b872dd': 'erc20-transferFrom',
  '0x3593564c': 'uniswap-universal-router'
};

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function extractPromptAmount(prompt = '') {
  const match = String(prompt).match(/(\d+(?:\.\d+)?)\s*(eth|usdc|usd|weth|mina)?/i);
  if (!match) return null;
  return {
    value: Number(match[1]),
    unit: String(match[2] || '').toUpperCase() || null
  };
}

function formatWeiToEthString(value) {
  try {
    const wei = BigInt(String(value || '0'));
    const whole = wei / 1000000000000000000n;
    const fraction = String(wei % 1000000000000000000n).padStart(18, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return '0';
  }
}

function classifyCalldata(data = '0x') {
  const normalized = String(data || '0x').trim().toLowerCase();
  if (normalized === '0x') {
    return {
      selector: '0x',
      label: SELECTOR_LABELS['0x'],
      recognized: true
    };
  }
  const selector = normalized.slice(0, 10);
  return {
    selector,
    label: SELECTOR_LABELS[selector] || 'unknown-contract-call',
    recognized: Boolean(SELECTOR_LABELS[selector])
  };
}

function buildCheck({
  id,
  label,
  passed,
  severity = passed ? 'info' : 'high',
  detail,
  evidence = null
}) {
  return {
    id,
    label,
    passed: Boolean(passed),
    severity,
    detail,
    evidence
  };
}

function buildDecisionSummary({ decision, selectorInfo, txValueEth, promptAmount, failedChecks, warnings }) {
  if (decision === 'REJECTED') {
    return `Rejected because ${failedChecks.map((check) => check.detail).join('; ')}.`;
  }
  if (decision === 'UNDECIDED') {
    return `Undecided: deterministic safety checks passed, but the ${selectorInfo.label} call needs deeper protocol-aware review before execution.`;
  }
  if (promptAmount?.value != null) {
    return `Approved: the transaction looks consistent with a ${promptAmount.value} ${promptAmount.unit || 'asset'} request and passed the current arbiter checks.`;
  }
  if (warnings.length) {
    return `Approved with caution: ${warnings[0].detail}`;
  }
  return `Approved: the transaction passed deterministic checks and the current arbiter heuristics for ${selectorInfo.label}.`;
}

export function buildNavaRequestHash({
  escrowAddress,
  userPrompt,
  tx,
  chainId = NAVA_DEFAULT_CHAIN_ID,
  contextLogs = null
}) {
  return `0x${sha256Hex(
    stableStringify({
      escrowAddress,
      userPrompt,
      tx,
      chainId,
      contextLogs
    })
  )}`;
}

export function evaluateNavaTransaction({
  escrowAddress,
  userPrompt,
  tx,
  chainId = NAVA_DEFAULT_CHAIN_ID
}) {
  const selectorInfo = classifyCalldata(tx?.data || '0x');
  const txValueEth = formatWeiToEthString(tx?.value || '0');
  const promptAmount = extractPromptAmount(userPrompt);
  const checks = [];

  checks.push(
    buildCheck({
      id: 'escrow-address-present',
      label: 'Escrow address bound',
      passed: Boolean(escrowAddress),
      detail: escrowAddress
        ? `Escrow address ${escrowAddress} is present for the verification request.`
        : 'Escrow address is missing.'
    })
  );
  checks.push(
    buildCheck({
      id: 'destination-not-zero',
      label: 'Destination address safety',
      passed: Boolean(tx?.to) && String(tx.to).toLowerCase() !== ZERO_ADDRESS,
      severity: 'critical',
      detail:
        tx?.to && String(tx.to).toLowerCase() !== ZERO_ADDRESS
          ? `Destination ${tx.to} is not the zero address.`
          : 'Transaction destination is the zero address.'
    })
  );
  checks.push(
    buildCheck({
      id: 'value-decimal-string',
      label: 'Value encoding',
      passed: /^\d+$/.test(String(tx?.value || '')),
      severity: 'high',
      detail: /^\d+$/.test(String(tx?.value || ''))
        ? `Transaction value ${tx?.value} is encoded as a decimal string.`
        : 'Transaction value must be a base-10 string.'
    })
  );
  checks.push(
    buildCheck({
      id: 'calldata-shape',
      label: 'Calldata encoding',
      passed: /^0x[0-9a-fA-F]*$/.test(String(tx?.data || '')),
      severity: 'high',
      detail: /^0x[0-9a-fA-F]*$/.test(String(tx?.data || ''))
        ? `Calldata shape is valid for ${selectorInfo.label}.`
        : 'Calldata must be a hex string prefixed with 0x.'
    })
  );
  checks.push(
    buildCheck({
      id: 'chain-id-supported',
      label: 'Chain identifier sanity',
      passed: Number.isFinite(Number(chainId)) && Number(chainId) > 0,
      severity: 'high',
      detail:
        Number.isFinite(Number(chainId)) && Number(chainId) > 0
          ? `Chain id ${chainId} is structurally valid.`
          : 'Chain id must be a positive integer.'
    })
  );

  const warnings = [];
  if (promptAmount?.unit === 'ETH') {
    const promptValue = promptAmount.value;
    const txValue = Number(txValueEth);
    if (Number.isFinite(promptValue) && Number.isFinite(txValue) && Math.abs(promptValue - txValue) > 0.000001) {
      warnings.push(
        buildCheck({
          id: 'prompt-amount-mismatch',
          label: 'Intent amount alignment',
          passed: false,
          severity: 'medium',
          detail: `Prompt mentions ${promptValue} ETH but calldata value is ${txValueEth} ETH.`,
          evidence: {
            promptValue,
            txValueEth
          }
        })
      );
    }
  }

  if (selectorInfo.label === 'unknown-contract-call') {
    warnings.push(
      buildCheck({
        id: 'unknown-selector',
        label: 'Protocol parsing coverage',
        passed: false,
        severity: 'medium',
        detail: `Selector ${selectorInfo.selector} is not covered by the current lightweight parser.`,
        evidence: {
          selector: selectorInfo.selector
        }
      })
    );
  }

  if (selectorInfo.label === 'erc20-approve') {
    warnings.push(
      buildCheck({
        id: 'approval-surface',
        label: 'Approval risk',
        passed: false,
        severity: 'medium',
        detail: 'ERC-20 approvals can expand spending authority and should be reviewed carefully.'
      })
    );
  }

  const failedChecks = checks.filter((check) => !check.passed);
  let decision = 'APPROVED';
  if (failedChecks.length > 0) {
    decision = 'REJECTED';
  } else if (selectorInfo.label === 'unknown-contract-call' || selectorInfo.label === 'erc20-approve') {
    decision = 'UNDECIDED';
  }

  const confidence =
    decision === 'REJECTED'
      ? 0.08
      : decision === 'UNDECIDED'
        ? 0.56
        : warnings.length > 0
          ? 0.84
          : 0.96;

  const reasoningNodes = [
    {
      id: 'deterministic-triggers',
      category: 'deterministic',
      result: failedChecks.length ? 'failed' : 'passed',
      checks
    },
    {
      id: 'intent-alignment',
      category: 'semantic',
      result: warnings.some((item) => item.id === 'prompt-amount-mismatch') ? 'warning' : 'passed',
      checks: promptAmount
        ? [
            buildCheck({
              id: 'prompt-amount-detected',
              label: 'Prompt amount parse',
              passed: true,
              detail: `Parsed prompt amount ${promptAmount.value}${promptAmount.unit ? ` ${promptAmount.unit}` : ''}.`
            }),
            ...warnings.filter((item) => item.id === 'prompt-amount-mismatch')
          ]
        : [
            buildCheck({
              id: 'prompt-amount-not-explicit',
              label: 'Prompt amount parse',
              passed: true,
              detail: 'No explicit numeric amount was found in the prompt; amount alignment remains qualitative.'
            })
          ]
    },
    {
      id: 'protocol-surface',
      category: 'semantic',
      result: selectorInfo.recognized ? 'passed' : 'warning',
      checks: [
        buildCheck({
          id: 'selector-classification',
          label: 'Selector classification',
          passed: selectorInfo.recognized,
          severity: selectorInfo.recognized ? 'info' : 'medium',
          detail: selectorInfo.recognized
            ? `Selector ${selectorInfo.selector} maps to ${selectorInfo.label}.`
            : `Selector ${selectorInfo.selector} is currently unknown.`
        }),
        ...warnings.filter((item) => item.id !== 'prompt-amount-mismatch')
      ]
    }
  ];

  const analysis = buildDecisionSummary({
    decision,
    selectorInfo,
    txValueEth,
    promptAmount,
    failedChecks,
    warnings
  });

  return {
    decision,
    confidence,
    analysis,
    selector: selectorInfo.selector,
    selectorLabel: selectorInfo.label,
    txValueEth,
    deterministicChecks: checks,
    warnings,
    reasoningNodes
  };
}

export function buildNavaOrionApproval(transaction, evaluation) {
  return {
    id: `orion-${transaction.id}`,
    transactionId: transaction.id,
    decision: evaluation.decision,
    type: 'orion',
    confidence: evaluation.confidence,
    analysis: evaluation.analysis,
    createdAt: new Date().toISOString(),
    reasoning: {
      selector: evaluation.selector,
      selectorLabel: evaluation.selectorLabel,
      deterministicChecks: evaluation.deterministicChecks,
      warnings: evaluation.warnings,
      nodes: evaluation.reasoningNodes
    }
  };
}

export function computeNavaTransactionStatus(transaction) {
  const latestUser = Array.isArray(transaction?.approvals?.user) && transaction.approvals.user.length
    ? transaction.approvals.user[transaction.approvals.user.length - 1]
    : null;
  const latestOrion = Array.isArray(transaction?.approvals?.orion) && transaction.approvals.orion.length
    ? transaction.approvals.orion[transaction.approvals.orion.length - 1]
    : null;

  if (latestUser?.decision === 'REJECTED' || latestOrion?.decision === 'REJECTED') return 'REJECTED';
  if (latestOrion?.decision === 'UNDECIDED') return 'UNDECIDED';
  if (latestOrion?.decision === 'APPROVED') return 'APPROVED';
  return transaction?.status || 'PENDING';
}

export function buildNavaVerificationStatus(transaction) {
  const latestOrion = Array.isArray(transaction?.approvals?.orion) && transaction.approvals.orion.length
    ? transaction.approvals.orion[transaction.approvals.orion.length - 1]
    : null;
  return {
    requestHash: transaction?.requestHash || null,
    status: latestOrion?.decision || 'PENDING',
    confidence: latestOrion?.confidence ?? null,
    analysis: latestOrion?.analysis || null,
    auditNetwork: transaction?.auditNetwork || NAVA_AUDIT_NETWORK,
    anchored: Boolean(transaction?.anchorSubmission?.payloadHash || transaction?.anchorSubmissionId),
    anchorStatus: transaction?.anchorSubmission?.status || transaction?.anchorStatus || 'planned'
  };
}

export function buildNavaAnchorPayload(transaction) {
  const requestCommitment = `0x${sha256Hex(
    stableStringify({
      requestHash: transaction.requestHash,
      escrowAddress: transaction.escrowAddress,
      chainId: transaction.chainId,
      tx: transaction.tx
    })
  )}`;
  const batchRoot = `0x${sha256Hex(
    stableStringify({
      requestHash: transaction.requestHash,
      status: computeNavaTransactionStatus(transaction),
      approvalStatus: buildNavaVerificationStatus(transaction)
    })
  )}`;
  const latestOrion = Array.isArray(transaction?.approvals?.orion) && transaction.approvals.orion.length
    ? transaction.approvals.orion[transaction.approvals.orion.length - 1]
    : null;
  return {
    schema: 'magic-city-anchor-v1',
    network: transaction.auditNetwork || NAVA_AUDIT_NETWORK,
    proofSystem: 'heuristic',
    program: 'NavaZekoCompatibilityArbiter',
    verificationKeyHash: null,
    statementHash: transaction.statementHash,
    statementKind: `nava_transaction:${String(computeNavaTransactionStatus(transaction)).toLowerCase()}`,
    sourceKind: 'nava_transaction',
    sourceId: transaction.id,
    publicInputs: {
      requestHash: transaction.requestHash,
      escrowAddress: transaction.escrowAddress,
      chainId: transaction.chainId,
      selector: latestOrion?.reasoning?.selector || null,
      verdict: latestOrion?.decision || 'PENDING',
      confidence: latestOrion?.confidence ?? null,
      requestCommitment,
      batchRoot,
      batchWindowId: 'nava-single',
      proofType: 'arbiter_verdict'
    },
    actor: {
      escrowAddress: transaction.escrowAddress
    },
    settlementRef: `nava:${transaction.requestHash}`,
    requestCommitment,
    batchRoot,
    batchWindowId: 'nava-single',
    proofType: 'arbiter_verdict',
    proofHash: `0x${sha256Hex(stableStringify(latestOrion || {}))}`,
    intentId: transaction.intentId || null,
    zkProof: null
  };
}

export function formatNavaTransaction(transaction) {
  return {
    id: transaction.id,
    requestHash: transaction.requestHash,
    description: transaction.userPrompt,
    status: computeNavaTransactionStatus(transaction),
    execution: Number(transaction.execution || 0),
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt
  };
}

export function formatNavaTransactionDetail(transaction) {
  return {
    ...formatNavaTransaction(transaction),
    escrowAddress: transaction.escrowAddress,
    chainId: transaction.chainId,
    tx: transaction.tx,
    contextLogs: transaction.contextLogs || null,
    auditNetwork: transaction.auditNetwork || NAVA_AUDIT_NETWORK,
    verification: buildNavaVerificationStatus(transaction),
    approvals: {
      user: Array.isArray(transaction.approvals?.user) ? transaction.approvals.user : [],
      orion: Array.isArray(transaction.approvals?.orion) ? transaction.approvals.orion : []
    },
    anchorSubmission: transaction.anchorSubmission || null,
    settlementRegistryEntryId: transaction.settlementRegistryEntryId || null
  };
}

export function formatNavaApprovalStatus(transaction) {
  return {
    user: Array.isArray(transaction?.approvals?.user) ? transaction.approvals.user : [],
    orion: Array.isArray(transaction?.approvals?.orion) ? transaction.approvals.orion : []
  };
}

export function buildNavaVerificationServices(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
  return [
    {
      id: 'orion-zeko-arbiter',
      name: 'Orion Zeko Arbiter',
      active: true,
      inbox: 'orion-zeko-inbox',
      type: 'arbiter',
      auditNetwork: NAVA_AUDIT_NETWORK,
      executionNetwork: 'ethereum:settlement-planned',
      capabilities: [
        'intent_alignment',
        'calldata_validation',
        'policy_screening',
        'zeko_audit_anchoring'
      ],
      endpoint: `${normalizedBaseUrl}/verification-services/orion-zeko-arbiter`,
      description: 'Primary Nava-on-Zeko arbiter with deterministic triggers and structured reasoning.'
    },
    {
      id: 'human-ui-approval',
      name: 'Human UI Approval',
      active: true,
      inbox: 'human-ui-review',
      type: 'manual-review',
      auditNetwork: NAVA_AUDIT_NETWORK,
      executionNetwork: 'ethereum:settlement-planned',
      capabilities: ['manual_override', 'user_confirmation', 'exception_review'],
      endpoint: `${normalizedBaseUrl}/verification-services/human-ui-approval`,
      description: 'Manual approval lane for user confirmation and exception handling.'
    }
  ];
}

export function buildNavaAgentProfile({ ethereumAddress, transactions = [] }) {
  const approvals = transactions.map((row) => buildNavaVerificationStatus(row));
  const approved = approvals.filter((row) => row.status === 'APPROVED').length;
  const rejected = approvals.filter((row) => row.status === 'REJECTED').length;
  const undecided = approvals.filter((row) => row.status === 'UNDECIDED').length;
  const avgConfidence =
    approvals.filter((row) => typeof row.confidence === 'number').length > 0
      ? approvals
          .filter((row) => typeof row.confidence === 'number')
          .reduce((sum, row) => sum + Number(row.confidence || 0), 0) /
        approvals.filter((row) => typeof row.confidence === 'number').length
      : null;

  return {
    ethereumAddress,
    auditNetwork: NAVA_AUDIT_NETWORK,
    settlementPlan: 'ethereum',
    transactions: transactions.length,
    approvals: {
      approved,
      rejected,
      undecided
    },
    averageConfidence: avgConfidence,
    anchoredTransactions: transactions.filter((row) => row.anchorSubmission?.payloadHash || row.anchorSubmissionId).length,
    lastActivityAt: transactions[0]?.updatedAt || null
  };
}

export function buildNavaAgentMetrics({ ethereumAddress, transactions = [], period = 'all' }) {
  const normalizedPeriod = ['24h', '7d', '30d', 'all'].includes(period) ? period : 'all';
  const now = Date.now();
  const filtered = transactions.filter((row) => {
    if (normalizedPeriod === 'all') return true;
    const createdAtMs = Date.parse(row.createdAt || 0);
    if (!Number.isFinite(createdAtMs)) return false;
    const ageMs = now - createdAtMs;
    if (normalizedPeriod === '24h') return ageMs <= 24 * 60 * 60 * 1000;
    if (normalizedPeriod === '7d') return ageMs <= 7 * 24 * 60 * 60 * 1000;
    if (normalizedPeriod === '30d') return ageMs <= 30 * 24 * 60 * 60 * 1000;
    return true;
  });
  const profile = buildNavaAgentProfile({ ethereumAddress, transactions: filtered });
  return {
    period: normalizedPeriod,
    ethereumAddress,
    transactions: profile.transactions,
    approvals: profile.approvals,
    averageConfidence: profile.averageConfidence,
    anchoredTransactions: profile.anchoredTransactions,
    auditNetwork: profile.auditNetwork,
    settlementPlan: profile.settlementPlan
  };
}
