const INFO_KEYWORDS = ['history', 'origin', 'origins', 'what is', "what's", 'explain', 'tell me about', 'why is', 'when did'];

export const WORKFLOW_DEFINITIONS = [
  {
    capability: 'general-chat',
    agentId: 'magic-chat',
    kind: 'chat',
    beta: false,
    laneLabel: 'Magic City',
    selectLabel: 'General Chat',
    summary: 'Answers broad questions directly and routes into deeper workflows when a structured lane is a better fit.',
    platformNote: 'Answers general questions directly and should suggest the right workflow when the request is better handled by a dedicated lane.',
    phases: {
      routing: 'routing request',
      reviewing: 'reviewing request',
      researching: 'researching answer',
      building: 'preparing response',
      retrying: 'switching provider'
    }
  },
  {
    capability: 'browser-worker-agent',
    agentId: 'browser-worker-agent',
    kind: 'workflow',
    beta: true,
    laneLabel: 'Magic Internet Agent',
    selectLabel: 'Magic Internet Agent',
    summary: 'Uses a real browser to open a target site, move a task forward, save artifacts, and pause at login, captcha, payment, final submit, or uncertainty.',
    platformNote: 'Opens a real browser for bounded web tasks, prepares carts/forms/searches where allowed, and stops at login, captcha, payment, final submit, or uncertain irreversible actions. It should never claim a purchase or submission is complete unless the user confirms it.',
    topicKeywords: ['website', 'site', 'url', 'browser', 'internet', 'checkout', 'cart', 'form', 'buy', 'purchase', 'order', 'shop', 'book', 'reserve', 'signup', 'sign up', 'amazon', 'walmart', 'target', 'instacart', 'job application', 'apply to jobs', 'linkedin jobs', 'greenhouse', 'lever', 'ashby', 'workable', 'indeed', 'ats'],
    actionKeywords: ['use this site', 'open this site', 'go to', 'browse', 'browser', 'internet', 'website', 'url', 'add to cart', 'fill out', 'fill in', 'checkout prep', 'checkout', 'buy', 'purchase', 'order', 'shop', 'book', 'reserve', 'sign up', 'signup', 'compare on', 'search on', 'amazon', 'walmart', 'target', 'instacart', 'job', 'jobs', 'job application', 'apply to jobs', 'apply for jobs', 'resume', 'cover letter', 'linkedin jobs', 'greenhouse', 'lever', 'workable', 'ashby', 'indeed', 'auto-submit', 'auto submit', 'job hunt'],
    infoKeywords: ['what is', "what's", 'explain', 'tell me about', 'history of'],
    connectedAccounts: [],
    paymentModes: ['free_preview', 'credits'],
    toolSchemas: ['browser.open', 'browser.inspect', 'browser.prepare_handoff'],
    phases: {
      routing: 'routing request',
      opening: 'opening browser',
      working: 'working in browser',
      pausing: 'preparing handoff',
      building: 'saving artifacts',
      retrying: 'retrying browser step'
    }
  }
];

const WORKFLOW_MAP = new Map(WORKFLOW_DEFINITIONS.map((definition) => [definition.capability, definition]));

function containsAny(source, list = []) {
  return list.some((entry) => source.includes(String(entry).toLowerCase()));
}

export function getWorkflowDefinition(capability = 'general-chat') {
  return WORKFLOW_MAP.get(String(capability || 'general-chat')) || WORKFLOW_MAP.get('general-chat');
}

export function listWorkflowDefinitions() {
  return [...WORKFLOW_DEFINITIONS];
}

export function listActionCapabilities() {
  return WORKFLOW_DEFINITIONS.filter((definition) => definition.kind === 'workflow').map((definition) => definition.capability);
}

export function inferWorkflowCapability(prompt, fallback = 'general-chat') {
  const lower = String(prompt || '').toLowerCase();
  for (const definition of WORKFLOW_DEFINITIONS) {
    if (definition.kind !== 'workflow') continue;
    const informational =
      definition.infoKeywords?.length &&
      containsAny(lower, definition.infoKeywords) &&
      containsAny(lower, definition.topicKeywords || definition.actionKeywords || []) &&
      !containsAny(lower, definition.actionKeywords || []);
    if (informational) return fallback;
    if (containsAny(lower, definition.actionKeywords || [])) return definition.capability;
  }
  return fallback;
}

export function listWorkflowDefinitionsForClient() {
  return WORKFLOW_DEFINITIONS.map((definition) => ({
    capability: definition.capability,
    agentId: definition.agentId,
    kind: definition.kind,
    beta: Boolean(definition.beta),
    laneLabel: definition.laneLabel,
    selectLabel: definition.selectLabel,
    summary: definition.summary,
    connectedAccounts: [...(definition.connectedAccounts || [])],
    paymentModes: [...(definition.paymentModes || [])],
    phases: { ...(definition.phases || {}) }
  }));
}

export function buildPlatformCapabilityPrompt() {
  const workflowLines = WORKFLOW_DEFINITIONS
    .filter((definition) => definition.kind === 'workflow')
    .map((definition) => `- ${definition.laneLabel}: ${definition.platformNote}`);
  return [
    'Magic City platform workflows currently available:',
    ...workflowLines,
    'Connected account capabilities:',
    '- Google Workspace: when connected and enabled, Magic City can create Calendar events, create Contacts, create Gmail drafts, and send approved email.',
    '- GitHub: when connected and allowlisted, Magic City can inspect repo context, generate patch artifacts, and stage or open draft PR flows.',
    '- Base wallet: when linked, Magic City can prepare wallet-backed signatures and Base USDC x402 payment approvals without holding private keys.',
    'If a request matches one of these workflows, do not claim Magic City cannot do it. If a permission, connected account, review gate, or checkout step is still required, say that plainly and describe the next truthful step.'
  ].join('\n');
}
