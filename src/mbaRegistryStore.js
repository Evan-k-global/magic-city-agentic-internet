import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { buildPostgresPoolOptions } from './postgresConfig.js';

const { Pool } = pg;
const DATA_PATH = path.resolve(process.cwd(), 'data', 'mba-mission-registry-state.json');
const DATABASE_URL = process.env.DATABASE_URL || '';
const REQUIRE_PRODUCTION_PERSISTENCE = String(process.env.MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE || '').toLowerCase() === 'true';
const pool = DATABASE_URL
  ? new Pool(buildPostgresPoolOptions({ connectionString: DATABASE_URL, requirePersistence: REQUIRE_PRODUCTION_PERSISTENCE }))
  : null;

let state = pool ? { registries: {} } : readFileState();
let persistence = {
  driver: pool ? 'postgres' : 'file',
  ready: false,
  healthy: false,
  lastWriteAt: null,
  lastWriteError: null
};

function readFileState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    return { registries: parsed?.registries && typeof parsed.registries === 'object' ? parsed.registries : {} };
  } catch (error) {
    if (error?.code === 'ENOENT') return { registries: {} };
    if (REQUIRE_PRODUCTION_PERSISTENCE) throw error;
    return { registries: {} };
  }
}

function persistFileState() {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  const temporaryPath = `${DATA_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2));
  fs.renameSync(temporaryPath, DATA_PATH);
  persistence = { ...persistence, healthy: true, lastWriteAt: new Date().toISOString(), lastWriteError: null };
}

async function initializeStore() {
  if (!pool) {
    if (REQUIRE_PRODUCTION_PERSISTENCE) {
      const error = new Error('mba_mission_registry_database_required');
      persistence = { ...persistence, ready: false, healthy: false, lastWriteError: error.message };
      throw error;
    }
    persistence = { ...persistence, ready: true, healthy: true };
    return;
  }
  try {
    await pool.query(`
      create table if not exists mba_mission_registry_states (
        registry_address text primary key,
        state_json jsonb not null,
        updated_at timestamptz not null
      )
    `);
    persistence = { ...persistence, ready: true, healthy: true };
  } catch (error) {
    persistence = { ...persistence, ready: false, healthy: false, lastWriteError: error instanceof Error ? error.message : String(error) };
    if (REQUIRE_PRODUCTION_PERSISTENCE) throw error;
  }
}

await initializeStore();

export async function getMbaMissionRegistryState(registryAddress) {
  const key = String(registryAddress || '').trim();
  if (!key) return null;
  if (!pool || persistence.driver !== 'postgres') return state.registries[key] ?? null;
  try {
    const result = await pool.query(
      'select state_json from mba_mission_registry_states where registry_address = $1',
      [key]
    );
    persistence = { ...persistence, healthy: true, lastWriteError: null };
    return result.rows[0]?.state_json ?? null;
  } catch (error) {
    persistence = { ...persistence, healthy: false, lastWriteError: error instanceof Error ? error.message : String(error) };
    throw error;
  }
}

export async function upsertMbaMissionRegistryState(registryAddress, patch = {}) {
  const key = String(registryAddress || '').trim();
  if (!key) throw new Error('mba_mission_registry_address_required');
  const current = await getMbaMissionRegistryState(key);
  const now = new Date().toISOString();
  const next = {
    ...(current || { registryAddress: key, createdAt: now }),
    ...patch,
    registryAddress: key,
    updatedAt: now
  };
  if (!pool || persistence.driver !== 'postgres') {
    state.registries[key] = next;
    persistFileState();
    return next;
  }
  try {
    await pool.query(
      `insert into mba_mission_registry_states (registry_address, state_json, updated_at)
       values ($1, $2::jsonb, $3)
       on conflict (registry_address) do update
         set state_json = excluded.state_json, updated_at = excluded.updated_at`,
      [key, JSON.stringify(next), now]
    );
    persistence = { ...persistence, healthy: true, lastWriteAt: now, lastWriteError: null };
    return next;
  } catch (error) {
    persistence = { ...persistence, healthy: false, lastWriteError: error instanceof Error ? error.message : String(error) };
    throw error;
  }
}

export function getMbaMissionRegistryPersistenceStatus() {
  return { ...persistence, databaseConfigured: Boolean(DATABASE_URL) };
}
