import process from 'node:process';

export const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
export const DEFAULT_BASE_URL = process.env.MAGIC_CITY_BASE_URL || 'https://magic-city.ai';
export const DEFAULT_APP_URL = process.env.MAGIC_CITY_APP_URL || DEFAULT_BASE_URL;
export const DEFAULT_REQUESTER_ID = process.env.MAGIC_CITY_REQUESTER_ID || '';
export const SESSION_COOKIE = process.env.MAGIC_CITY_SESSION_COOKIE || '';
export const PUBLIC_API_KEY = process.env.MAGIC_CITY_PUBLIC_API_KEY || '';

export class MagicCityHttpClient {
  constructor({
    baseUrl,
    appUrl,
    requesterId,
    sessionCookie,
    publicApiKey,
    accessToken
  }) {
    this.baseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.appUrl = String(appUrl || DEFAULT_APP_URL).replace(/\/+$/, '');
    this.requesterId = String(requesterId || DEFAULT_REQUESTER_ID).trim();
    this.sessionCookie = String(sessionCookie || SESSION_COOKIE).trim();
    this.publicApiKey = String(publicApiKey || PUBLIC_API_KEY).trim();
    this.accessToken = String(accessToken || '').trim();
  }

  defaultSuccessUrl() {
    return `${this.appUrl}/?stripe=success`;
  }

  defaultCancelUrl() {
    return `${this.appUrl}/?stripe=cancel`;
  }

  async request(path, { method = 'GET', body = null, headers = {} } = {}) {
    const nextHeaders = {
      accept: 'application/json',
      ...headers
    };
    if (body !== null) nextHeaders['content-type'] = 'application/json';
    if (this.sessionCookie) nextHeaders.cookie = `magic_city_session=${this.sessionCookie}`;
    if (this.accessToken && !nextHeaders.authorization) {
      nextHeaders.authorization = `Bearer ${this.accessToken}`;
    }
    if (this.publicApiKey && !nextHeaders['x-api-key']) nextHeaders['x-api-key'] = this.publicApiKey;
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: nextHeaders,
        body: body === null ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      const wrapped = new Error(`magic_city_backend_unreachable:${this.baseUrl}`);
      wrapped.detail = {
        baseUrl: this.baseUrl,
        reason: error instanceof Error ? error.message : String(error)
      };
      throw wrapped;
    }
    this.captureSessionCookie(response);
    const raw = await response.text();
    const parsed = raw ? safeJsonParse(raw) : null;
    if (!response.ok) {
      const detail = parsed ?? raw;
      const error = new Error(`Magic City API ${method} ${path} failed with ${response.status}`);
      error.status = response.status;
      error.detail = detail;
      throw error;
    }
    return parsed ?? { ok: true, raw };
  }

  captureSessionCookie(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
    if (!Array.isArray(setCookies) || setCookies.length === 0) return;
    for (const raw of setCookies) {
      const match = String(raw || '').match(/(?:^|,\s*)magic_city_session=([^;]+)/);
      if (match?.[1]) this.sessionCookie = match[1];
    }
  }
}

function readOnlyTool() {
  return { readOnlyHint: true };
}

export function buildMagicCityMcpTools(
  client,
  {
    exposeAccountAuthTools = true,
    exposePlatformTools = true,
    exposeSettlementRegistryTools = true
  } = {}
) {
  const tools = {
    route_intent: {
      description: 'Route a request through Magic City and return the assistant result, action approval payload, or connector session handoff.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What Magic City should do.' },
          capability: { type: 'string', description: 'Optional lane hint such as general-chat, food-order, meeting-package, or spreadsheet-cleanup.' },
          budget: { type: 'number', description: 'Credit budget for the run. Defaults to 1.' },
          privacyMode: { type: 'string', description: 'public, private, agent-private, or confidential.' },
          requesterId: { type: 'string', description: 'Stable requester identity. Falls back to MAGIC_CITY_REQUESTER_ID if omitted.' },
          context: {
            type: 'array',
            description: 'Recent chat context.',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string' },
                content: { type: 'string' }
              },
              required: ['role', 'content']
            }
          },
          profileSummary: { type: 'object', additionalProperties: true },
          metadata: { type: 'object', additionalProperties: true }
        },
        required: ['prompt']
      },
      handler: async (args = {}) => {
        const requesterId = String(args.requesterId || client.requesterId || '').trim() || undefined;
        return client.request('/intent', {
          method: 'POST',
          body: {
            prompt: String(args.prompt || ''),
            capability: String(args.capability || 'general-chat'),
            budget: Number.isFinite(Number(args.budget)) ? Number(args.budget) : 1,
            privacyMode: String(args.privacyMode || 'private'),
            requesterId,
            context: Array.isArray(args.context) ? args.context : [],
            profileSummary: isPlainObject(args.profileSummary) ? args.profileSummary : {},
            metadata: isPlainObject(args.metadata) ? args.metadata : {}
          }
        });
      }
    },
    get_intent: {
      description: 'Fetch a routed Magic City intent by id.',
      annotations: readOnlyTool(),
      inputSchema: {
        type: 'object',
        properties: {
          intentId: { type: 'string' }
        },
        required: ['intentId']
      },
      handler: async (args = {}) => client.request(`/intent/${encodeURIComponent(String(args.intentId || ''))}`)
    },
    get_account_history: {
      description: 'Fetch recent Magic City account history: intents, action approvals, and connector sessions for the authenticated user.',
      annotations: readOnlyTool(),
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number' }
        }
      },
      handler: async (args = {}) =>
        client.request(`/auth/history${Number.isFinite(Number(args.limit)) ? `?limit=${Math.max(1, Math.min(100, Number(args.limit)))}` : ''}`)
    },
    list_actions: {
      description: 'List recent action approval runs waiting for approval or already finalized.',
      annotations: readOnlyTool(),
      inputSchema: {
        type: 'object',
        properties: {}
      },
      handler: async () => client.request('/actions')
    },
    get_action: {
      description: 'Fetch a Magic City action run by id.',
      annotations: readOnlyTool(),
      inputSchema: {
        type: 'object',
        properties: {
          actionRunId: { type: 'string' }
        },
        required: ['actionRunId']
      },
      handler: async (args = {}) => client.request(`/actions/${encodeURIComponent(String(args.actionRunId || ''))}`)
    },
    approve_action: {
      description: 'Approve a Magic City action run and create the connector session when approval is required.',
      inputSchema: {
        type: 'object',
        properties: {
          actionRunId: { type: 'string' }
        },
        required: ['actionRunId']
      },
      handler: async (args = {}) => client.request(`/actions/${encodeURIComponent(String(args.actionRunId || ''))}/approve`, { method: 'POST', body: {} })
    },
    reject_action: {
      description: 'Reject a Magic City action run.',
      inputSchema: {
        type: 'object',
        properties: {
          actionRunId: { type: 'string' }
        },
        required: ['actionRunId']
      },
      handler: async (args = {}) => client.request(`/actions/${encodeURIComponent(String(args.actionRunId || ''))}/reject`, { method: 'POST', body: {} })
    },
    get_connector_session: {
      description: 'Fetch a Magic City connector session, including current execution state and task package.',
      annotations: readOnlyTool(),
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' }
        },
        required: ['sessionId']
      },
      handler: async (args = {}) => client.request(`/connectors/sessions/${encodeURIComponent(String(args.sessionId || ''))}`)
    },
    start_connector_execution: {
      description: 'Start execution for a Magic City connector session, usually after approving an action run.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          mode: { type: 'string', description: 'agent_checkout or human_checkout.' },
          requesterId: { type: 'string' },
          selections: { type: 'object', additionalProperties: true },
          localPrivateInputs: { type: 'object', additionalProperties: true }
        },
        required: ['sessionId']
      },
      handler: async (args = {}) => {
        const requesterId = String(args.requesterId || client.requesterId || '').trim() || undefined;
        return client.request(`/connectors/sessions/${encodeURIComponent(String(args.sessionId || ''))}/start-execution`, {
          method: 'POST',
          body: {
            mode: String(args.mode || 'agent_checkout'),
            requesterId,
            selections: isPlainObject(args.selections) ? args.selections : {},
            localPrivateInputs: isPlainObject(args.localPrivateInputs) ? args.localPrivateInputs : {}
          }
        });
      }
    },
    get_wallet: {
      description: 'Fetch the authenticated Magic City account and wallet state.',
      annotations: readOnlyTool(),
      inputSchema: {
        type: 'object',
        properties: {}
      },
      handler: async () => client.request('/auth/session')
    },
    create_credit_topup: {
      description: 'Create a Stripe Checkout session to top up Magic City credits.',
      inputSchema: {
        type: 'object',
        properties: {
          amountCredits: { type: 'number' },
          requesterId: { type: 'string' },
          successUrl: { type: 'string' },
          cancelUrl: { type: 'string' }
        },
        required: ['amountCredits']
      },
      handler: async (args = {}) => {
        const requesterId = String(args.requesterId || client.requesterId || '').trim();
        if (!requesterId) {
          const authSession = await client.request('/auth/session');
          const inferredRequesterId = String(authSession?.user?.requesterId || '').trim();
          if (!inferredRequesterId) throw new Error('requesterId_missing_for_credit_topup');
          return client.request('/billing/stripe/checkout-session', {
            method: 'POST',
            body: {
              amountCredits: Number(args.amountCredits),
              requesterId: inferredRequesterId,
              successUrl: String(args.successUrl || client.defaultSuccessUrl()),
              cancelUrl: String(args.cancelUrl || client.defaultCancelUrl())
            }
          });
        }
        return client.request('/billing/stripe/checkout-session', {
          method: 'POST',
          body: {
            amountCredits: Number(args.amountCredits),
            requesterId,
            successUrl: String(args.successUrl || client.defaultSuccessUrl()),
            cancelUrl: String(args.cancelUrl || client.defaultCancelUrl())
          }
        });
      }
    }
  };

  if (exposePlatformTools) {
    tools.list_execution_agents = {
      description: 'List currently registered Magic City execution agents.',
      annotations: readOnlyTool(),
      inputSchema: {
        type: 'object',
        properties: {}
      },
      handler: async () => client.request('/execution-agents')
    };
  }

  if (exposeSettlementRegistryTools) {
    tools.create_settlement_commitment_challenge = {
      description: 'Create a wallet-signing challenge for a settlement commitment. Agents can sign the returned SIWE/EVM message off-platform and then register the signature-backed commitment.',
      inputSchema: {
        type: 'object',
        properties: {
          settlementId: { type: 'string' },
          sessionId: { type: 'string' },
          address: { type: 'string' },
          chainId: { type: 'number' },
          commitmentHash: { type: 'string' },
          memo: { type: 'string' }
        },
        required: ['address']
      },
      handler: async (args = {}) => client.request('/zeko/settlement-registry/challenge', {
        method: 'POST',
        body: {
          settlementId: args.settlementId ? String(args.settlementId) : undefined,
          sessionId: args.sessionId ? String(args.sessionId) : undefined,
          address: String(args.address || ''),
          chainId: Number.isFinite(Number(args.chainId)) ? Number(args.chainId) : undefined,
          commitmentHash: args.commitmentHash ? String(args.commitmentHash) : undefined,
          memo: args.memo ? String(args.memo) : undefined
        }
      })
    };
    tools.list_settlement_registry = {
      description: 'List Zeko settlement registry entries prepared by Magic City and external agents. This is the lean proof/anchor registry surface for settlement truth.',
      annotations: readOnlyTool(),
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          settlementId: { type: 'string' },
          sessionId: { type: 'string' },
          scope: { type: 'string' },
          signer: { type: 'string' }
        }
      },
      handler: async (args = {}) => {
        const params = new URLSearchParams();
        if (Number.isFinite(Number(args.limit))) params.set('limit', String(Math.max(1, Math.min(200, Number(args.limit)))));
        if (args.settlementId) params.set('settlementId', String(args.settlementId));
        if (args.sessionId) params.set('sessionId', String(args.sessionId));
        if (args.scope) params.set('scope', String(args.scope));
        if (args.signer) params.set('signer', String(args.signer));
        const query = params.toString();
        return client.request(`/zeko/settlement-registry${query ? `?${query}` : ''}`);
      }
    };
    tools.get_settlement_registry_entry = {
      description: 'Fetch one Zeko settlement registry entry by id.',
      annotations: readOnlyTool(),
      inputSchema: {
        type: 'object',
        properties: {
          registryEntryId: { type: 'string' }
        },
        required: ['registryEntryId']
      },
      handler: async (args = {}) => client.request(`/zeko/settlement-registry/${encodeURIComponent(String(args.registryEntryId || ''))}`)
    };
    tools.register_settlement_commitment = {
      description: 'Register an external memo-based or signature-based commitment against a Magic City settlement. This is the lightweight external-agent Zeko surface, without recursive on-chain verification.',
      inputSchema: {
        type: 'object',
        properties: {
          settlementId: { type: 'string' },
          sessionId: { type: 'string' },
          memo: { type: 'string' },
          commitmentHash: { type: 'string' },
          signer: { type: 'string' },
          signerType: { type: 'string' },
          signature: { type: 'string' },
          signatureScheme: { type: 'string' },
          walletChallengeId: { type: 'string' },
          walletAddress: { type: 'string' },
          chainId: { type: 'number' },
          signedMessage: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true }
        }
      },
      handler: async (args = {}) => client.request('/zeko/settlement-registry/register', {
        method: 'POST',
        body: {
          settlementId: args.settlementId ? String(args.settlementId) : undefined,
          sessionId: args.sessionId ? String(args.sessionId) : undefined,
          memo: args.memo ? String(args.memo) : undefined,
          commitmentHash: args.commitmentHash ? String(args.commitmentHash) : undefined,
          signer: args.signer ? String(args.signer) : undefined,
          signerType: args.signerType ? String(args.signerType) : undefined,
          signature: args.signature ? String(args.signature) : undefined,
          signatureScheme: args.signatureScheme ? String(args.signatureScheme) : undefined,
          walletChallengeId: args.walletChallengeId ? String(args.walletChallengeId) : undefined,
          walletAddress: args.walletAddress ? String(args.walletAddress) : undefined,
          chainId: Number.isFinite(Number(args.chainId)) ? Number(args.chainId) : undefined,
          signedMessage: args.signedMessage ? String(args.signedMessage) : undefined,
          metadata: isPlainObject(args.metadata) ? args.metadata : {}
        }
      })
    };
  }

  if (exposeAccountAuthTools) {
    tools.register_account = {
      description: 'Create a Magic City account and store the authenticated session cookie inside this MCP process.',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          passphrase: { type: 'string' },
          displayName: { type: 'string' },
          referralCode: { type: 'string' }
        },
        required: ['email', 'passphrase']
      },
      handler: async (args = {}) => client.request('/auth/register', {
        method: 'POST',
        body: {
          email: String(args.email || '').trim(),
          passphrase: String(args.passphrase || ''),
          displayName: String(args.displayName || '').trim(),
          referralCode: String(args.referralCode || '').trim()
        }
      })
    };

    tools.login_account = {
      description: 'Log into Magic City and persist the authenticated session cookie inside this MCP process.',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          passphrase: { type: 'string' }
        },
        required: ['email', 'passphrase']
      },
      handler: async (args = {}) => client.request('/auth/login', {
        method: 'POST',
        body: {
          email: String(args.email || '').trim(),
          passphrase: String(args.passphrase || '')
        }
      })
    };

    tools.logout_account = {
      description: 'Log out the current Magic City account from this MCP process.',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      handler: async () => {
        const result = await client.request('/auth/logout', {
          method: 'POST',
          body: {}
        });
        client.sessionCookie = '';
        return result;
      }
    };
  }

  return tools;
}

export function buildMagicCityMcpResources(
  client,
  {
    exposePlatformResources = true,
    exposeSettlementRegistryResources = true
  } = {}
) {
  const resources = {
    'magic-city://execution-agents': {
      name: 'Magic City Execution Agents',
      description: 'Registered execution agents and plugin metadata.',
      mimeType: 'application/json',
      read: async () => client.request('/execution-agents')
    },
    'magic-city://auth-session': {
      name: 'Magic City Auth Session',
      description: 'Authenticated user and wallet state for the current session.',
      mimeType: 'application/json',
      read: async () => client.request('/auth/session')
    },
    'magic-city://auth-history': {
      name: 'Magic City Auth History',
      description: 'Recent intents, action approvals, and connector sessions for the authenticated user.',
      mimeType: 'application/json',
      read: async () => client.request('/auth/history')
    },
    'magic-city://billing/stripe-config': {
      name: 'Magic City Stripe Config',
      description: 'Stripe wallet configuration, top-up defaults, and credit ratio.',
      mimeType: 'application/json',
      read: async () => client.request('/billing/stripe/config')
    },
    'magic-city://billing/square-config': {
      name: 'Magic City Square Config',
      description: 'Square merchant checkout configuration.',
      mimeType: 'application/json',
      read: async () => client.request('/billing/square/config')
    }
  };

  if (!exposePlatformResources) {
    delete resources['magic-city://execution-agents'];
  }

  if (exposeSettlementRegistryResources) {
    resources['magic-city://zeko/settlement-registry'] = {
      name: 'Magic City Zeko Settlement Registry',
      description: 'Public registry of settlement commitments, anchor preparation, and sponsored Zeko truth records.',
      mimeType: 'application/json',
      read: async () => client.request('/zeko/settlement-registry')
    };
  }

  return resources;
}

export function createMagicCityMcpRuntime({
  baseUrl,
  appUrl,
  requesterId,
  sessionCookie,
  publicApiKey,
  accessToken,
  exposeAccountAuthTools = true,
  exposePlatformTools = true,
  exposeSettlementRegistryTools = true,
  exposePlatformResources = true,
  exposeSettlementRegistryResources = true
} = {}) {
  const client = new MagicCityHttpClient({
    baseUrl,
    appUrl,
    requesterId,
    sessionCookie,
    publicApiKey,
    accessToken
  });
  const tools = buildMagicCityMcpTools(client, {
    exposeAccountAuthTools,
    exposePlatformTools,
    exposeSettlementRegistryTools
  });
  const resources = buildMagicCityMcpResources(client, {
    exposePlatformResources,
    exposeSettlementRegistryResources
  });
  return {
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    client,
    tools,
    resources,
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false }
    },
    serverInfo: {
      name: 'magic-city',
      version: '0.2.0'
    },
    instructions: 'Magic City routes user requests into paid or free agent workflows, credit-backed execution, private connector sessions, and Zeko-backed settlement truth.'
  };
}

export async function handleMagicCityMcpMessage(runtime, message) {
  if (message.jsonrpc !== '2.0') {
    if (message.id !== undefined) {
      return buildError(message.id, -32600, 'Invalid Request', { reason: 'jsonrpc_version_must_be_2_0' });
    }
    return null;
  }

  const method = String(message.method || '');
  if (!method) {
    if (message.id !== undefined) return buildError(message.id, -32600, 'Invalid Request', { reason: 'missing_method' });
    return null;
  }

  if (method.startsWith('notifications/')) return null;

  try {
    if (method === 'initialize') {
      return buildResult(message.id, {
        protocolVersion: message.params?.protocolVersion || runtime.protocolVersion || DEFAULT_PROTOCOL_VERSION,
        capabilities: runtime.capabilities,
        serverInfo: runtime.serverInfo,
        instructions: runtime.instructions
      });
    }

    if (method === 'ping') return buildResult(message.id, {});

    if (method === 'tools/list') {
      return buildResult(message.id, {
        tools: Object.entries(runtime.tools).map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations || undefined
        }))
      });
    }

    if (method === 'tools/call') {
      const name = String(message.params?.name || '');
      const tool = runtime.tools[name];
      if (!tool) return buildError(message.id, -32601, 'Method not found', { reason: `unknown_tool:${name}` });
      const result = await tool.handler(message.params?.arguments || {});
      return buildResult(message.id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      });
    }

    if (method === 'resources/list') {
      return buildResult(message.id, {
        resources: Object.entries(runtime.resources).map(([uri, resource]) => ({
          uri,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType
        }))
      });
    }

    if (method === 'resources/read') {
      const uri = String(message.params?.uri || '');
      const resource = runtime.resources[uri];
      if (!resource) return buildError(message.id, -32602, 'Invalid params', { reason: `unknown_resource:${uri}` });
      const result = await resource.read();
      return buildResult(message.id, {
        contents: [
          {
            uri,
            mimeType: resource.mimeType,
            text: JSON.stringify(result, null, 2)
          }
        ]
      });
    }

    return buildError(message.id, -32601, 'Method not found', { method });
  } catch (error) {
    return buildError(message.id, -32000, error.message || 'internal_error', error.detail || null);
  }
}

function buildResult(id, result) {
  if (id === undefined || id === null) return null;
  return { jsonrpc: '2.0', id, result };
}

function buildError(id, code, message, data = null) {
  if (id === undefined || id === null) return null;
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data
    }
  };
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
