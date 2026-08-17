const GITHUB_OAUTH_BASE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_USER_EMAILS_URL = 'https://api.github.com/user/emails';

export const GITHUB_CAPABILITY_SCOPES = {
  repoRead: 'public_repo',
  prDrafts: 'public_repo'
};

export const GITHUB_CAPABILITY_LABELS = {
  repoRead: 'Repo metadata',
  patchArtifacts: 'Patch artifacts',
  prDrafts: 'PR draft packages'
};

function getGitHubClientId() {
  const value = String(process.env.GITHUB_CLIENT_ID || '').trim();
  if (!value) throw new Error('github_not_configured');
  return value;
}

function getGitHubClientSecret() {
  const value = String(process.env.GITHUB_CLIENT_SECRET || '').trim();
  if (!value) throw new Error('github_not_configured');
  return value;
}

export function getGitHubRedirectUri() {
  const value = String(process.env.GITHUB_REDIRECT_URI || '').trim();
  if (!value) throw new Error('github_redirect_uri_not_configured');
  return value;
}

export function isGitHubConfigured() {
  return Boolean(
    String(process.env.GITHUB_CLIENT_ID || '').trim() &&
    String(process.env.GITHUB_CLIENT_SECRET || '').trim() &&
    String(process.env.GITHUB_REDIRECT_URI || '').trim()
  );
}

function normalizeScopes(scopes = []) {
  return [...new Set((Array.isArray(scopes) ? scopes : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

export function buildGitHubScopesForPolicy(policy = {}) {
  const scopes = ['read:user', 'user:email'];
  if (policy?.allowRepoRead || policy?.allowPrDraftWrite) scopes.push('public_repo');
  return normalizeScopes(scopes);
}

export function buildGitHubAuthorizationUrl({ state, scopes = [], allowSignup = true }) {
  const params = new URLSearchParams({
    client_id: getGitHubClientId(),
    redirect_uri: getGitHubRedirectUri(),
    scope: normalizeScopes(scopes).join(' '),
    state
  });
  params.set('allow_signup', allowSignup ? 'true' : 'false');
  return `${GITHUB_OAUTH_BASE}?${params.toString()}`;
}

async function readGitHubJson(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(data?.error_description || data?.message || data?.error || `github_request_failed:${response.status}`);
    err.statusCode = response.status;
    err.details = data;
    throw err;
  }
  return data;
}

function buildGitHubHeaders(accessToken = '') {
  return {
    accept: 'application/json',
    'user-agent': 'magic-city-github-connector',
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
  };
}

export async function exchangeGitHubCode({ code }) {
  const params = new URLSearchParams({
    client_id: getGitHubClientId(),
    client_secret: getGitHubClientSecret(),
    code: String(code || ''),
    redirect_uri: getGitHubRedirectUri()
  });
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      ...buildGitHubHeaders(),
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  return readGitHubJson(response);
}

function normalizeRepoFullName(fullName = '') {
  const repo = String(fullName || '').trim().replace(/^\/+|\/+$/g, '');
  if (!repo || !repo.includes('/')) throw new Error('github_repo_required');
  return repo;
}

function encodeGitHubPath(pathname = '') {
  return String(pathname || '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function githubApiRequest(url, accessToken = '', options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    ...buildGitHubHeaders(accessToken),
    ...(options.headers || {})
  };
  let body = options.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !(body instanceof URLSearchParams)) {
    headers['content-type'] = headers['content-type'] || 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(url, {
    method,
    headers,
    body
  });
  return readGitHubJson(response);
}

export async function fetchGitHubUserProfile(accessToken) {
  return githubApiRequest(GITHUB_USER_URL, accessToken);
}

export async function fetchGitHubUserEmails(accessToken) {
  const data = await githubApiRequest(GITHUB_USER_EMAILS_URL, accessToken);
  return Array.isArray(data) ? data : [];
}

export async function fetchGitHubRepo(accessToken, fullName) {
  const repo = normalizeRepoFullName(fullName);
  return githubApiRequest(`https://api.github.com/repos/${repo}`, accessToken);
}

export async function fetchGitHubIssue(accessToken, fullName, number) {
  const repo = normalizeRepoFullName(fullName);
  const issueNumber = Number(number || 0);
  if (!issueNumber) throw new Error('github_issue_required');
  return githubApiRequest(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, accessToken);
}

export async function fetchGitHubBranch(accessToken, fullName, branchName) {
  const repo = normalizeRepoFullName(fullName);
  const branch = String(branchName || '').trim();
  if (!branch) throw new Error('github_branch_required');
  return githubApiRequest(`https://api.github.com/repos/${repo}/branches/${encodeURIComponent(branch)}`, accessToken);
}

export async function createGitHubBranch(accessToken, fullName, branchName, sha) {
  const repo = normalizeRepoFullName(fullName);
  const branch = String(branchName || '').trim();
  const commitSha = String(sha || '').trim();
  if (!branch) throw new Error('github_branch_required');
  if (!commitSha) throw new Error('github_branch_sha_required');
  return githubApiRequest(`https://api.github.com/repos/${repo}/git/refs`, accessToken, {
    method: 'POST',
    body: {
      ref: `refs/heads/${branch}`,
      sha: commitSha
    }
  });
}

export async function fetchGitHubContent(accessToken, fullName, filePath, branchName = '') {
  const repo = normalizeRepoFullName(fullName);
  const targetPath = encodeGitHubPath(filePath);
  if (!targetPath) throw new Error('github_file_path_required');
  const url = new URL(`https://api.github.com/repos/${repo}/contents/${targetPath}`);
  if (String(branchName || '').trim()) url.searchParams.set('ref', String(branchName || '').trim());
  return githubApiRequest(url.toString(), accessToken);
}

export async function upsertGitHubContent(accessToken, fullName, filePath, { branch, message, content, sha } = {}) {
  const repo = normalizeRepoFullName(fullName);
  const targetPath = encodeGitHubPath(filePath);
  if (!targetPath) throw new Error('github_file_path_required');
  const branchName = String(branch || '').trim();
  const commitMessage = String(message || '').trim();
  if (!branchName) throw new Error('github_branch_required');
  if (!commitMessage) throw new Error('github_commit_message_required');
  return githubApiRequest(`https://api.github.com/repos/${repo}/contents/${targetPath}`, accessToken, {
    method: 'PUT',
    body: {
      message: commitMessage,
      branch: branchName,
      content: Buffer.from(String(content || ''), 'utf8').toString('base64'),
      ...(sha ? { sha: String(sha) } : {})
    }
  });
}

export async function listGitHubPullRequests(accessToken, fullName, { state = 'open', head = '' } = {}) {
  const repo = normalizeRepoFullName(fullName);
  const url = new URL(`https://api.github.com/repos/${repo}/pulls`);
  url.searchParams.set('state', state);
  if (String(head || '').trim()) url.searchParams.set('head', String(head || '').trim());
  const data = await githubApiRequest(url.toString(), accessToken);
  return Array.isArray(data) ? data : [];
}

export async function createGitHubPullRequest(accessToken, fullName, { title, head, base, body, draft = true } = {}) {
  const repo = normalizeRepoFullName(fullName);
  const prTitle = String(title || '').trim();
  const prHead = String(head || '').trim();
  const prBase = String(base || '').trim();
  if (!prTitle) throw new Error('github_pr_title_required');
  if (!prHead) throw new Error('github_pr_head_required');
  if (!prBase) throw new Error('github_pr_base_required');
  return githubApiRequest(`https://api.github.com/repos/${repo}/pulls`, accessToken, {
    method: 'POST',
    body: {
      title: prTitle,
      head: prHead,
      base: prBase,
      body: String(body || ''),
      draft: Boolean(draft)
    }
  });
}
