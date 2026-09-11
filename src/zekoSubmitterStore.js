import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { buildPostgresPoolOptions } from './postgresConfig.js';

const { Pool } = pg;
const DATA_PATH = process.env.MAGIC_CITY_ZEKO_SUBMITTER_STATE_PATH
  ? path.resolve(process.env.MAGIC_CITY_ZEKO_SUBMITTER_STATE_PATH)
  : path.resolve(process.cwd(), 'data', 'zeko-submitter-state.json');
const DATABASE_URL = process.env.DATABASE_URL || '';
const REQUIRE_PRODUCTION_PERSISTENCE = String(process.env.MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE || '').toLowerCase() === 'true';
const SCHEMA_MANAGED_EXTERNALLY = String(process.env.MAGIC_CITY_RELAYER_SCHEMA_MANAGED || '').toLowerCase() === 'true';
const pool = DATABASE_URL
  ? new Pool(buildPostgresPoolOptions({ connectionString: DATABASE_URL, requirePersistence: REQUIRE_PRODUCTION_PERSISTENCE }))
  : null;

let state = pool ? defaultState() : loadFileState();
let persistence = {
  driver: pool ? 'postgres' : 'file',
  ready: false,
  healthy: false,
  migratedFromFile: false,
  lastWriteAt: null,
  lastWriteError: null
};

function defaultState() {
  return { submissions: [] };
}

function loadFileState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    return { submissions: Array.isArray(parsed?.submissions) ? parsed.submissions : [] };
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultState();
    if (REQUIRE_PRODUCTION_PERSISTENCE) throw error;
    return defaultState();
  }
}

function persistFileState() {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  const temporaryPath = `${DATA_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2));
  fs.renameSync(temporaryPath, DATA_PATH);
  persistence.lastWriteAt = new Date().toISOString();
  persistence.lastWriteError = null;
  persistence.healthy = true;
}

function normalizeSubmission(row = {}) {
  return {
    id: row.id || `zsub-${crypto.randomUUID()}`,
    createdAt: row.createdAt || new Date().toISOString(),
    updatedAt: row.updatedAt || new Date().toISOString(),
    ...row
  };
}

async function initializeStore() {
  if (!pool) {
    if (REQUIRE_PRODUCTION_PERSISTENCE) throw new Error('zeko_relayer_database_required');
    persistence.ready = true;
    persistence.healthy = true;
    return;
  }
  try {
    if (SCHEMA_MANAGED_EXTERNALLY) {
      await pool.query('select id from zeko_relayer_submissions limit 1');
    } else {
      await pool.query(`
        create table if not exists zeko_relayer_submissions (
          id text primary key,
          anchor_key text,
          payload_hash text,
          submission_json jsonb not null,
          created_at timestamptz not null,
          updated_at timestamptz not null
        )
      `);
      await pool.query('alter table zeko_relayer_submissions add column if not exists anchor_key text');
      await pool.query('alter table zeko_relayer_submissions add column if not exists payload_hash text');
      await pool.query("update zeko_relayer_submissions set anchor_key = submission_json ->> 'anchorKey', payload_hash = submission_json ->> 'payloadHash' where anchor_key is null or payload_hash is null");
      await pool.query('create unique index if not exists zeko_relayer_submissions_anchor_key_uidx on zeko_relayer_submissions (anchor_key) where anchor_key is not null');
      await pool.query('create unique index if not exists zeko_relayer_submissions_payload_hash_uidx on zeko_relayer_submissions (payload_hash) where payload_hash is not null');
      await pool.query('create index if not exists zeko_relayer_submissions_created_at_idx on zeko_relayer_submissions (created_at desc)');
    }
    const count = await pool.query('select count(*)::int as count from zeko_relayer_submissions');
    if (count.rows[0]?.count === 0) {
      state = loadFileState();
    }
    if (count.rows[0]?.count === 0 && state.submissions.length) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const row of state.submissions.map(normalizeSubmission)) {
          await client.query(
            `insert into zeko_relayer_submissions (id, anchor_key, payload_hash, submission_json, created_at, updated_at)
             values ($1, $2, $3, $4::jsonb, $5, $6)
             on conflict (id) do nothing`,
            [row.id, row.anchorKey || null, row.payloadHash || null, JSON.stringify(row), row.createdAt, row.updatedAt]
          );
        }
        await client.query('commit');
        persistence.migratedFromFile = true;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }
    persistence.ready = true;
    persistence.healthy = true;
  } catch (error) {
    persistence.lastWriteError = error instanceof Error ? error.message : String(error);
    if (REQUIRE_PRODUCTION_PERSISTENCE) throw error;
    console.error('[zeko-relayer] postgres_init_failed_falling_back_to_file', persistence.lastWriteError);
    persistence = { ...persistence, driver: 'file', ready: true, healthy: true };
  }
}

await initializeStore();

async function writePostgresSubmission(row) {
  await pool.query(
    `insert into zeko_relayer_submissions (id, anchor_key, payload_hash, submission_json, created_at, updated_at)
     values ($1, $2, $3, $4::jsonb, $5, $6)
     on conflict (id) do update
       set anchor_key = excluded.anchor_key, payload_hash = excluded.payload_hash,
           submission_json = excluded.submission_json, updated_at = excluded.updated_at`,
    [row.id, row.anchorKey || null, row.payloadHash || null, JSON.stringify(row), row.createdAt, row.updatedAt]
  );
  persistence.healthy = true;
  persistence.lastWriteAt = new Date().toISOString();
  persistence.lastWriteError = null;
}

function recordWriteFailure(error) {
  persistence.healthy = false;
  persistence.lastWriteError = error instanceof Error ? error.message : String(error);
}

export async function createSubmission(row) {
  const submission = normalizeSubmission(row);
  if (persistence.driver !== 'postgres') {
    state.submissions.push(submission);
    persistFileState();
    return submission;
  }
  try {
    await writePostgresSubmission(submission);
    return submission;
  } catch (error) {
    recordWriteFailure(error);
    throw error;
  }
}

export async function createOrGetSubmission(row) {
  const submission = normalizeSubmission(row);
  const anchorKey = String(submission.anchorKey || '').trim();
  const payloadHash = String(submission.payloadHash || '').trim();
  if (!anchorKey || !payloadHash) throw new Error('submission_idempotency_key_required');
  if (persistence.driver !== 'postgres') {
    const existing = state.submissions.find((candidate) => candidate.anchorKey === anchorKey || candidate.payloadHash === payloadHash);
    if (existing) return { submission: existing, created: false };
    state.submissions.push(submission);
    persistFileState();
    return { submission, created: true };
  }
  try {
    const inserted = await pool.query(
      `insert into zeko_relayer_submissions (id, anchor_key, payload_hash, submission_json, created_at, updated_at)
       values ($1, $2, $3, $4::jsonb, $5, $6)
       on conflict do nothing
       returning submission_json`,
      [submission.id, anchorKey, payloadHash, JSON.stringify(submission), submission.createdAt, submission.updatedAt]
    );
    if (inserted.rows[0]?.submission_json) {
      persistence.healthy = true;
      persistence.lastWriteAt = submission.updatedAt;
      persistence.lastWriteError = null;
      return { submission: inserted.rows[0].submission_json, created: true };
    }
    const existing = await pool.query(
      `select submission_json from zeko_relayer_submissions
        where anchor_key = $1 or payload_hash = $2
        order by created_at asc
        limit 1`,
      [anchorKey, payloadHash]
    );
    if (!existing.rows[0]?.submission_json) throw new Error('submission_idempotency_conflict_missing_row');
    persistence.healthy = true;
    persistence.lastWriteError = null;
    return { submission: existing.rows[0].submission_json, created: false };
  } catch (error) {
    recordWriteFailure(error);
    throw error;
  }
}

export async function updateSubmission(id, patch) {
  const current = await getSubmission(id);
  if (!current) return null;
  const updated = normalizeSubmission({ ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: new Date().toISOString() });
  if (persistence.driver !== 'postgres') {
    const index = state.submissions.findIndex((row) => row.id === id);
    state.submissions[index] = updated;
    persistFileState();
    return updated;
  }
  try {
    await writePostgresSubmission(updated);
    return updated;
  } catch (error) {
    recordWriteFailure(error);
    throw error;
  }
}

export async function getSubmission(id) {
  if (persistence.driver !== 'postgres') return state.submissions.find((row) => row.id === id) ?? null;
  const result = await pool.query('select submission_json from zeko_relayer_submissions where id = $1', [id]);
  return result.rows[0]?.submission_json ?? null;
}

export async function findSubmissionByPayloadHash(payloadHash) {
  const normalized = String(payloadHash || '').trim();
  if (!normalized) return null;
  if (persistence.driver !== 'postgres') {
    return state.submissions.slice().reverse().find((row) => row.payloadHash === normalized) ?? null;
  }
  const result = await pool.query(
    `select submission_json
       from zeko_relayer_submissions
      where submission_json ->> 'payloadHash' = $1
      order by created_at desc
      limit 1`,
    [normalized]
  );
  return result.rows[0]?.submission_json ?? null;
}

export async function listSubmissions(limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  if (persistence.driver !== 'postgres') return state.submissions.slice(-safeLimit).reverse();
  const result = await pool.query(
    'select submission_json from zeko_relayer_submissions order by created_at desc limit $1',
    [safeLimit]
  );
  return result.rows.map((row) => row.submission_json);
}

export function getZekoRelayerPersistenceStatus() {
  return { ...persistence, databaseConfigured: Boolean(DATABASE_URL), schemaManagedExternally: SCHEMA_MANAGED_EXTERNALLY };
}
