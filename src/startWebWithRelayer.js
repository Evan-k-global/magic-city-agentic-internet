import { spawn } from 'node:child_process';
import { setPriority } from 'node:os';

const shouldStartRelayer =
  process.env.ZEKO_SUBMIT_MODE === 'relay' &&
  process.env.ZEKO_RELAYER_MODE === 'mission_auth_registry' &&
  process.env.ZEKO_RELAYER_URL;
const shouldStartProofWorker = Boolean(process.env.ZEKO_PROOF_WORKER_URL);

const children = [];
let shuttingDown = false;

function startChild(label, args) {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: process.env
  });
  children.push({ label, child });
  const requestedPriority = label === 'zeko-proof-worker'
    ? Number(process.env.ZEKO_PROOF_WORKER_PRIORITY || 19)
    : label === 'zeko-relayer'
      ? Number(process.env.ZEKO_RELAYER_JOB_PRIORITY || 10)
      : null;
  if (Number.isFinite(requestedPriority) && child.pid) {
    try {
      setPriority(child.pid, Math.max(-20, Math.min(19, requestedPriority)));
      console.log(`[magic-city-launcher] ${label} process priority=${requestedPriority}`);
    } catch (error) {
      console.warn(`[magic-city-launcher] ${label} priority setup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  child.on('exit', (code, signal) => {
    console.log(`[magic-city-launcher] ${label} exited code=${code} signal=${signal}`);
    if (label === 'web') process.exit(shuttingDown ? 0 : code ?? (signal ? 1 : 0));
    const restartable =
      (label === 'zeko-relayer' && shouldStartRelayer) ||
      (label === 'zeko-proof-worker' && shouldStartProofWorker);
    if (restartable && !shuttingDown) {
      setTimeout(() => {
        const index = children.findIndex((entry) => entry.child === child);
        if (index >= 0) children.splice(index, 1);
        console.log('[magic-city-launcher] restarting embedded Zeko relayer');
        startChild('zeko-relayer', args);
      }, 2000);
    }
  });
  return child;
}

function stopChildren(signal) {
  shuttingDown = true;
  for (const { child } of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on('SIGINT', () => {
  stopChildren('SIGINT');
});

process.on('SIGTERM', () => {
  stopChildren('SIGTERM');
});

if (shouldStartRelayer) {
  console.log('[magic-city-launcher] starting embedded Zeko relayer');
  startChild('zeko-relayer', ['src/zekoRelayerServer.js']);
}

if (shouldStartProofWorker) {
  console.log('[magic-city-launcher] starting low-priority Zeko proof worker');
  startChild('zeko-proof-worker', ['src/zekoProofWorker.js']);
}

startChild('web', ['src/server.js']);
