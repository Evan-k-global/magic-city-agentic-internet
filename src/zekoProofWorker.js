import http from 'node:http';
import os from 'node:os';
import { buildAnchorPayload, generateArtifactProof, verifyArtifactProof } from './zekoProof.js';

const HOST = process.env.ZEKO_PROOF_WORKER_HOST || '127.0.0.1';
const PORT = Number(process.env.ZEKO_PROOF_WORKER_PORT || 4413);
const TOKEN = String(process.env.ZEKO_PROOF_WORKER_TOKEN || '');
const PRIORITY = Math.max(0, Math.min(19, Number(process.env.ZEKO_PROOF_WORKER_PRIORITY || 10) || 10));
const VERIFY_GENERATED_PROOF = String(process.env.ZEKO_PROOF_WORKER_VERIFY_GENERATED_PROOF || '').toLowerCase() === 'true';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
let prepareQueue = Promise.resolve();
let prepareQueueDepth = 0;
let prepareActive = false;

try {
  os.setPriority(process.pid, PRIORITY);
} catch {
  // A lower priority is a performance guardrail, not a correctness dependency.
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function authorized(req) {
  if (!TOKEN) return true;
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown_error');
  return message.replace(/\s+/g, ' ').slice(0, 500);
}

function enqueuePrepare(task) {
  prepareQueueDepth += 1;
  const run = prepareQueue
    .catch(() => null)
    .then(async () => {
      prepareQueueDepth -= 1;
      prepareActive = true;
      try {
        return await task();
      } finally {
        prepareActive = false;
      }
    });
  prepareQueue = run.catch(() => null);
  return run;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'zeko-proof-worker',
      priority: PRIORITY,
      tokenRequired: Boolean(TOKEN),
      prepareActive,
      prepareQueueDepth
    });
  }
  if (req.method !== 'POST' || req.url !== '/prepare') return sendJson(res, 404, { error: 'not_found' });
  if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' });

  const startedAt = Date.now();
  try {
    const { proofArtifact, network } = await readJson(req);
    if (!proofArtifact || typeof proofArtifact !== 'object' || !network) {
      return sendJson(res, 400, { error: 'missing_proof_artifact_or_network' });
    }
    const payload = await enqueuePrepare(async () => {
      console.info(`[zeko-proof-worker] prepare_started queueDepth=${prepareQueueDepth}`);
      const zkProof = await generateArtifactProof(proofArtifact);
      console.info(`[zeko-proof-worker] proof_generated durationMs=${Date.now() - startedAt}`);
      const proofVerification = VERIFY_GENERATED_PROOF
        ? await verifyArtifactProof(zkProof)
        : { verified: true, source: 'internal_generation', publicInput: zkProof.publicInput };
      console.info(`[zeko-proof-worker] proof_precheck_${VERIFY_GENERATED_PROOF ? 'verified' : 'trusted_internal'} durationMs=${Date.now() - startedAt}`);
      const anchorPayload = await buildAnchorPayload({
        proofArtifact,
        zkProof,
        network: String(network),
        proofVerification
      });
      console.info(`[zeko-proof-worker] prepare_completed durationMs=${Date.now() - startedAt}`);
      return { zkProof, proofVerification, anchorPayload };
    });
    return sendJson(res, 200, payload);
  } catch (error) {
    const code = error instanceof Error ? error.name : 'unknown_error';
    const message = safeErrorMessage(error);
    console.warn(`[zeko-proof-worker] prepare_failed durationMs=${Date.now() - startedAt} code=${code} message=${JSON.stringify(message)}`);
    return sendJson(res, error?.statusCode || 500, { error: 'proof_prepare_failed', code, message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[zeko-proof-worker] listening on http://${HOST}:${PORT} priority=${PRIORITY}`);
});
