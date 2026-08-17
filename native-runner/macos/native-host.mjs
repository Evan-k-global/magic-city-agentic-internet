import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(
  process.env.MAGIC_CITY_RUNNER_REPO_ROOT ||
  currentDir,
  process.env.MAGIC_CITY_RUNNER_REPO_ROOT ? '' : '../..'
);
const stateDir = path.join(os.homedir(), '.magic-city', 'native-runner');
const statePath = path.join(stateDir, 'state.json');
const logDir = path.join(stateDir, 'logs');

function ensureDirs() {
  fs.mkdirSync(logDir, { recursive: true });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(patch = {}) {
  ensureDirs();
  const state = {
    ...readState(),
    ...patch,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return state;
}

function pidIsRunning(pid) {
  const value = Number(pid || 0);
  if (!value) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value = '') {
  return String(value || 'https://magic-city-staging.fly.dev').trim().replace(/\/+$/, '') || 'https://magic-city-staging.fly.dev';
}

function startBrowserWorker(message = {}) {
  ensureDirs();
  const deviceToken = String(message.deviceToken || '').trim();
  if (!deviceToken) throw new Error('missing_device_token');

  const baseUrl = normalizeBaseUrl(message.baseUrl);
  const useExistingBrowser = Boolean(message.useExistingBrowser);
  const requestedDeviceId = String(message.deviceId || '').trim();
  const requestedMode = useExistingBrowser ? 'existing_chrome_cdp' : 'dedicated_magic_city_profile';
  const existing = readState();
  if (pidIsRunning(existing.pid)) {
    const sameBaseUrl = normalizeBaseUrl(existing.baseUrl || '') === baseUrl;
    const sameDevice = Boolean(requestedDeviceId && String(existing.deviceId || '') === requestedDeviceId);
    const sameMode = String(existing.mode || '') === requestedMode;
    if (sameBaseUrl && sameDevice && sameMode) {
      return {
        running: true,
        alreadyRunning: true,
        pid: existing.pid,
        startedAt: existing.startedAt || null,
        baseUrl: existing.baseUrl || null,
        mode: existing.mode || null
      };
    }
    try {
      process.kill(Number(existing.pid), 'SIGTERM');
    } catch {}
    writeState({
      pid: null,
      previousPid: existing.pid || null,
      restartedAt: new Date().toISOString(),
      restartReason: 'runner_context_changed'
    });
  }

  const browserProfileDir = path.join(os.homedir(), '.magic-city', 'browser-profile');
  const outLog = path.join(logDir, 'browser-worker.out.log');
  const errLog = path.join(logDir, 'browser-worker.err.log');
  const outFd = fs.openSync(outLog, 'a');
  const errFd = fs.openSync(errLog, 'a');

  const env = {
    ...process.env,
    MAGIC_CITY_BASE_URL: baseUrl,
    MAGIC_CITY_NATIVE_RUNNER_TOKEN: deviceToken,
    MAGIC_CITY_BROWSER_WORKER_PLUGIN_ID: message.pluginId || 'local-authenticated-browser-plugin',
    MAGIC_CITY_BROWSER_WORKER_OWNER: message.ownerAgentId || 'local-authenticated-browser-agent',
    MAGIC_CITY_PLUGIN_POLL_MS: String(message.pollMs || 1500),
    MAGIC_CITY_BROWSER_WORKER_TIMEOUT_MS: String(message.browserWorkerTimeoutMs || 180000)
  };
  if (useExistingBrowser) {
    env.MAGIC_CITY_BROWSER_CDP_URL = message.cdpUrl || 'http://127.0.0.1:9222';
  } else {
    env.MAGIC_CITY_BROWSER_USER_DATA_DIR = browserProfileDir;
  }

  const workerArgs = fs.existsSync(path.join(repoRoot, '.env'))
    ? ['--env-file=.env', 'src/localBrowserWorkerPlugin.js']
    : ['src/localBrowserWorkerPlugin.js'];
  const child = spawn(process.execPath, workerArgs, {
    cwd: repoRoot,
    env,
    detached: true,
    stdio: ['ignore', outFd, errFd]
  });
  child.unref();

  const state = writeState({
    pid: child.pid,
    baseUrl,
    mode: requestedMode,
    deviceId: requestedDeviceId || null,
    tokenLast4: deviceToken.slice(-4),
    startedAt: new Date().toISOString(),
    outLog,
    errLog,
    browserProfileDir: useExistingBrowser ? null : browserProfileDir,
    repoRoot
  });

  return {
    running: true,
    alreadyRunning: false,
    pid: child.pid,
    startedAt: state.startedAt,
    baseUrl,
    mode: state.mode,
    outLog,
    errLog
  };
}

function stopBrowserWorker() {
  const state = readState();
  if (!pidIsRunning(state.pid)) {
    writeState({ pid: null, stoppedAt: new Date().toISOString() });
    return { running: false, stopped: false };
  }
  process.kill(Number(state.pid), 'SIGTERM');
  writeState({ pid: null, stoppedAt: new Date().toISOString() });
  return { running: false, stopped: true };
}

function status() {
  const state = readState();
  return {
    running: pidIsRunning(state.pid),
    pid: state.pid || null,
    startedAt: state.startedAt || null,
    updatedAt: state.updatedAt || null,
    baseUrl: state.baseUrl || null,
    mode: state.mode || null,
    outLog: state.outLog || null,
    errLog: state.errLog || null,
    repoRoot: state.repoRoot || repoRoot
  };
}

function readMessage() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    process.stdin.on('data', (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      const buffer = Buffer.concat(chunks, total);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) return;
      const body = buffer.subarray(4, 4 + length).toString('utf8');
      resolve(JSON.parse(body));
    });
    process.stdin.on('error', reject);
    process.stdin.on('end', () => resolve({ type: 'STATUS_BROWSER_WORKER' }));
  });
}

function writeMessage(payload = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]), () => {
    process.exit(0);
  });
}

async function main() {
  const message = await readMessage();
  let result;
  if (message?.type === 'START_BROWSER_WORKER') {
    result = startBrowserWorker(message);
  } else if (message?.type === 'STOP_BROWSER_WORKER') {
    result = stopBrowserWorker();
  } else {
    result = status();
  }
  writeMessage({ ok: true, result });
}

main().catch((error) => {
  writeMessage({ ok: false, error: error?.message || String(error) });
});
