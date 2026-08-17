import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { stopMagicCityProcesses } from './processControl.js';

const MODE = process.argv[2] || 'plugins';
const ROOT = process.cwd();
const NODE = process.execPath;
const ENV_FILE = path.resolve(ROOT, '.env');
const APP_BASE_URL = process.env.MAGIC_CITY_BASE_URL || 'http://127.0.0.1:4411';
const HEALTH_URL = `${APP_BASE_URL.replace(/\/$/, '')}/health`;

const processGroups = {
	  plugins: [
	    { name: 'browser', script: 'src/localBrowserWorkerPlugin.js' },
	    { name: 'food', script: 'src/localFoodPlugin.js' },
	    { name: 'travel', script: 'src/localTravelPlugin.js' },
    { name: 'job', script: 'src/localJobApplicationPlugin.js' }
  ],
	  all: [
	    { name: 'app', script: 'src/server.js' },
	    { name: 'browser', script: 'src/localBrowserWorkerPlugin.js' },
	    { name: 'food', script: 'src/localFoodPlugin.js' },
	    { name: 'travel', script: 'src/localTravelPlugin.js' },
    { name: 'job', script: 'src/localJobApplicationPlugin.js' }
  ]
};

const targets = processGroups[MODE];
if (!targets) {
  console.error(`[launcher] unknown mode: ${MODE}`);
  process.exit(1);
}

const children = [];
let shuttingDown = false;

function prefixStream(stream, label, writer) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      writer(`[${label}] ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buffer) writer(`[${label}] ${buffer}\n`);
  });
}

function startTarget(target) {
  const child = spawn(NODE, ['--env-file', ENV_FILE, target.script], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.push(child);
  prefixStream(child.stdout, target.name, (line) => process.stdout.write(line));
  prefixStream(child.stderr, target.name, (line) => process.stderr.write(line));
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    process.stderr.write(`[launcher] ${target.name} exited with ${reason}\n`);
    shutdown(code && code !== 0 ? code : 1);
  });
  return child;
}

async function waitForAppReady(timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(HEALTH_URL);
      if (response.ok) return true;
    } catch {
      // app not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
    process.exit(exitCode);
  }, 500).unref();
}

async function main() {
  process.stdout.write('[launcher] checking for existing Magic City processes\n');
  const stopped = await stopMagicCityProcesses({
    includeLauncher: false,
    excludePids: [process.pid],
    log: (line) => process.stdout.write(`${line}\n`)
  });
  if (stopped.remaining.length > 0) {
    process.stderr.write('[launcher] could not fully stop existing Magic City processes\n');
    shutdown(1);
    return;
  }

  if (MODE === 'all') {
    const [app, ...plugins] = targets;
    startTarget(app);
    process.stdout.write(`[launcher] waiting for app health at ${HEALTH_URL}\n`);
    const ready = await waitForAppReady();
    if (!ready) {
      process.stderr.write('[launcher] app did not become healthy in time\n');
      shutdown(1);
      return;
    }
    for (const target of plugins) {
      startTarget(target);
    }
  } else {
    for (const target of targets) {
      startTarget(target);
    }
  }

  process.stdout.write(`[launcher] started ${targets.map((target) => target.name).join(', ')}\n`);
}

main().catch((error) => {
  process.stderr.write(`[launcher] fatal: ${error.message}\n`);
  shutdown(1);
});
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
