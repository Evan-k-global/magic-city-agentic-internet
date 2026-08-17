export class MagicCityAgentSDK {
  constructor({ baseUrl, apiKey = '', agentId = '', runtimeToken = '', fetchImpl = globalThis.fetch } = {}) {
    if (!baseUrl) throw new Error('MagicCityAgentSDK requires baseUrl');
    if (typeof fetchImpl !== 'function') throw new Error('MagicCityAgentSDK requires fetch');
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.agentId = agentId;
    this.runtimeToken = runtimeToken;
    this.fetch = fetchImpl;
  }

  async manifest() {
    return this.request('/agent-sdk/v1/manifest');
  }

  async proposeMission({ goal, mission = {}, constraints = {}, budget = null, publicContext = null, registrySource = '' } = {}) {
    return this.request('/agent-sdk/v1/missions', {
      method: 'POST',
      body: { agentId: this.agentId, goal, mission, constraints, budget, publicContext, registrySource }
    });
  }

  async listMissions({ limit = 50 } = {}) {
    const params = new URLSearchParams();
    if (this.agentId) params.set('agentId', this.agentId);
    params.set('limit', String(limit));
    return this.request(`/agent-sdk/v1/missions?${params.toString()}`);
  }

  async getMission(missionId) {
    return this.request(`/agent-sdk/v1/missions/${encodeURIComponent(missionId)}`);
  }

  async submitOptions(missionId, options) {
    return this.request(`/agent-sdk/v1/missions/${encodeURIComponent(missionId)}/options`, {
      method: 'POST',
      body: { agentId: this.agentId, options: Array.isArray(options) ? options : [options] }
    });
  }

  async submitArtifact(missionId, { label, content, extension = 'md', metadata = {} } = {}) {
    return this.request(`/agent-sdk/v1/missions/${encodeURIComponent(missionId)}/artifacts`, {
      method: 'POST',
      body: { agentId: this.agentId, label, content, extension, metadata }
    });
  }

  async requestBrowserWorker(missionId, { targetUrl, goal = '', constraints = '', budget = '', actionDepth = 'Prepare cart or form', stopCondition = 'Pause at login, captcha, payment, final submit, or uncertainty' } = {}) {
    return this.request(`/agent-sdk/v1/missions/${encodeURIComponent(missionId)}/browser-worker/request`, {
      method: 'POST',
      body: {
        agentId: this.agentId,
        targetUrl,
        goal,
        constraints,
        budget,
        actionDepth,
        stopCondition,
        checkoutRunnerMode: 'local_runner_or_browser_autofill'
      }
    });
  }

  async receipts(missionId) {
    return this.request(`/agent-sdk/v1/missions/${encodeURIComponent(missionId)}/receipts`);
  }

  async request(path, { method = 'GET', body = undefined, headers = {} } = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
        ...(this.agentId ? { 'x-magic-city-agent-id': this.agentId } : {}),
        ...(this.runtimeToken ? { authorization: `Bearer ${this.runtimeToken}` } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `magic_city_http_${response.status}`);
      error.status = response.status;
      error.response = data;
      throw error;
    }
    return data;
  }
}

export default MagicCityAgentSDK;
