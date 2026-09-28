import crypto from 'node:crypto';
import pg from 'pg';
import { buildPostgresPoolOptions } from './postgresConfig.js';

export const RATE_LIMIT_SCHEMA = `CREATE TABLE IF NOT EXISTS magic_city_rate_limits (
  key_hash text PRIMARY KEY, timestamps double precision[] NOT NULL,
  expires_at timestamptz NOT NULL, allowed boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS magic_city_rate_limits_expiry ON magic_city_rate_limits (expires_at);`;

// PgBouncer rejects statement_timeout as a startup parameter. A transaction
// pins one backend; SET LOCAL bounds the work and cannot leak to another user.
export async function runLimiterQuery(pool, text, values) {
  const client = await pool.connect();
  let failure;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '2000ms'");
    const result = await client.query(text, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    failure = error;
    // Destroy rather than reuse an uncertain/timed-out transaction. In
    // particular, never return a still-running client to the pool.
    throw error;
  } finally {
    client.release(failure);
  }
}

export function createRequestLimiter({ env = process.env, pool = null, clock = Date.now, maxEntries = 10000 } = {}) {
  const driver = env.MAGIC_CITY_RATE_LIMIT_STORE || 'memory';
  if (!['memory', 'postgres'].includes(driver)) throw new Error('invalid_rate_limit_store');
  const memory = new Map();
  let lastSweep = 0;
  const db = driver === 'postgres' ? pool || new pg.Pool({
    ...buildPostgresPoolOptions({ connectionString: env.DATABASE_URL, requirePersistence: true }),
    max: 4, connectionTimeoutMillis: 2000, query_timeout: 2500,
    allowExitOnIdle: true
  }) : null;
  db?.on?.('error', () => {}); // Request failures below still fail closed.
  return {
    async initialize() {
      if (db) {
        if (env.MAGIC_CITY_RATE_LIMIT_SCHEMA_MANAGED !== 'true') await runLimiterQuery(db, RATE_LIMIT_SCHEMA);
        await runLimiterQuery(db, 'SELECT key_hash FROM magic_city_rate_limits LIMIT 0');
      }
    },
    async consume(key, { windowMs, max }) {
      const now = clock();
      if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isInteger(max) || max < 1) throw new Error('invalid_rate_limit');
      const hash = crypto.createHash('sha256').update(key).digest('hex');
      if (db) {
        // PostgreSQL serializes the ON CONFLICT update for this key, including
        // concurrent requests from other web processes. Denied hits do not
        // extend the window or grow the array.
        const active = '(SELECT coalesce(array_agg(t ORDER BY t), ARRAY[]::double precision[]) FROM unnest(r.timestamps) t WHERE t > excluded.timestamps[1] - $2)';
        const result = await runLimiterQuery(db, `WITH tick AS MATERIALIZED (SELECT (extract(epoch FROM statement_timestamp()) * 1000)::double precision AS ms)
          INSERT INTO magic_city_rate_limits AS r (key_hash, timestamps, expires_at, allowed)
          SELECT $1, ARRAY[ms], to_timestamp((ms + $2) / 1000.0), true FROM tick
          ON CONFLICT (key_hash) DO UPDATE SET
          allowed = cardinality(${active}) < $3,
          timestamps = CASE WHEN cardinality(${active}) < $3
            THEN ${active} || excluded.timestamps[1] ELSE ${active} END,
          expires_at = excluded.expires_at
          RETURNING allowed, greatest(1000, $2 - ((SELECT ms FROM tick) - timestamps[1])) AS retry_ms`, [hash, windowMs, max]);
        if (now - lastSweep > 60000) {
          lastSweep = now;
          // A bounded cleanup keeps expired identities from growing forever.
          void runLimiterQuery(db, 'DELETE FROM magic_city_rate_limits WHERE key_hash IN (SELECT key_hash FROM magic_city_rate_limits WHERE expires_at < now() LIMIT 1000)').catch(() => {});
        }
        const row = result.rows[0];
        return { allowed: row.allowed, retryAfterMs: row.allowed ? 0 : Number(row.retry_ms) };
      }
      if (now - lastSweep > 60000 || memory.size >= maxEntries) {
        for (const [k, value] of memory) if (value.expires <= now) memory.delete(k);
        lastSweep = now;
      }
      const entry = memory.get(hash);
      if (!entry && memory.size >= maxEntries) throw new Error('rate_limit_capacity_exceeded');
      const timestamps = (entry?.timestamps || []).filter((t) => t > now - windowMs);
      if (timestamps.length >= max) return { allowed: false, retryAfterMs: Math.max(1000, windowMs - (now - timestamps[0])) };
      timestamps.push(now);
      memory.set(hash, { timestamps, expires: now + windowMs });
      return { allowed: true, retryAfterMs: 0 };
    },
    async close() { if (db && !pool) await db.end(); }
  };
}
