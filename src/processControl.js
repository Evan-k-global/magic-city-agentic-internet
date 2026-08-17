import { execFileSync } from 'node:child_process';
import process from 'node:process';

export const PROCESS_PATTERNS = [
  'agent-verification/src/server.js',
  'agent-verification/src/localBrowserWorkerPlugin.js',
  'agent-verification/src/localFoodPlugin.js',
  'agent-verification/src/localTravelPlugin.js',
  'agent-verification/src/localJobApplicationPlugin.js',
  'agent-verification/src/startProcesses.js'
];

export const MAGIC_CITY_PORTS = [4411, 4412];

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { stdio: 'pipe' }).toString();
  } catch (error) {
    return error.stdout ? error.stdout.toString() : '';
  }
}

export function findMatchingPids(patterns = PROCESS_PATTERNS, exclude = []) {
  const excludeSet = new Set(exclude.map(String));
  const matches = [];
  for (const pattern of patterns) {
    const pids = run('pgrep', ['-f', pattern])
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((pid) => !excludeSet.has(String(pid)));
    for (const pid of pids) {
      matches.push({ pid: String(pid), pattern, source: 'pattern' });
    }
  }
  const seen = new Set();
  return matches.filter(({ pid, pattern }) => {
    const key = `${pid}:${pattern}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function findListeningPortPids(ports = MAGIC_CITY_PORTS, exclude = []) {
  const excludeSet = new Set(exclude.map(String));
  const matches = [];
  for (const port of ports) {
    const pids = run('lsof', ['-t', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((pid) => !excludeSet.has(String(pid)));
    for (const pid of pids) {
      matches.push({ pid: String(pid), pattern: `port:${port}`, source: 'port' });
    }
  }
  const seen = new Set();
  return matches.filter(({ pid, pattern }) => {
    const key = `${pid}:${pattern}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function killPids(matches, signal = 'TERM') {
  const killed = [];
  for (const { pid, pattern, source } of matches) {
    try {
      execFileSync('kill', [`-${signal}`, pid]);
      killed.push({ pid, pattern, signal, source });
    } catch {
      // ignore per-pid kill failure
    }
  }
  return killed;
}

export async function stopMagicCityProcesses(options = {}) {
  const {
    includeLauncher = true,
    includePorts = true,
    log = () => {},
    graceMs = 600,
    force = true,
    excludePids = [process.pid]
  } = options;

  const patterns = includeLauncher
    ? PROCESS_PATTERNS
    : PROCESS_PATTERNS.filter((pattern) => !pattern.endsWith('startProcesses.js'));

  const firstPass = [
    ...findMatchingPids(patterns, excludePids),
    ...(includePorts ? findListeningPortPids(MAGIC_CITY_PORTS, excludePids) : [])
  ];
  if (firstPass.length === 0) {
    return { killed: [], remaining: [] };
  }

  const termKilled = killPids(firstPass, 'TERM');
  for (const { pid, pattern, source } of termKilled) {
    log(`[process] stopped ${pid} (${pattern}, ${source}) with SIGTERM`);
  }

  await new Promise((resolve) => setTimeout(resolve, graceMs));

  const remaining = [
    ...findMatchingPids(patterns, excludePids),
    ...(includePorts ? findListeningPortPids(MAGIC_CITY_PORTS, excludePids) : [])
  ];
  if (force && remaining.length > 0) {
    const killKilled = killPids(remaining, 'KILL');
    for (const { pid, pattern, source } of killKilled) {
      log(`[process] force-stopped ${pid} (${pattern}, ${source}) with SIGKILL`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const finalRemaining = [
    ...findMatchingPids(patterns, excludePids),
    ...(includePorts ? findListeningPortPids(MAGIC_CITY_PORTS, excludePids) : [])
  ];
  return {
    killed: termKilled,
    remaining: finalRemaining
  };
}
