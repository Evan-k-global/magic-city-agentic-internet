import pg from 'pg';

const { Client } = pg;
const adminUrl = String(process.env.DATABASE_ADMIN_URL || '').trim();
const username = String(process.env.MBA_RELAYER_DATABASE_USER || 'magic_city_mba_relayer').trim();
const password = String(process.env.MBA_RELAYER_DATABASE_PASSWORD || '').trim();

if (!adminUrl) throw new Error('DATABASE_ADMIN_URL_required');
if (!password) throw new Error('MBA_RELAYER_DATABASE_PASSWORD_required');
if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(username)) throw new Error('MBA_RELAYER_DATABASE_USER_invalid');

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

const databaseName = decodeURIComponent(new URL(adminUrl).pathname.replace(/^\//, ''));
if (!databaseName) throw new Error('DATABASE_ADMIN_URL_database_required');

const client = new Client({ connectionString: adminUrl });
await client.connect();
try {
  await client.query('begin');
  await client.query(`
    create table if not exists mba_mission_registry_states (
      registry_address text primary key,
      state_json jsonb not null,
      updated_at timestamptz not null
    )
  `);
  await client.query(`
    create table if not exists zeko_relayer_submissions (
      id text primary key,
      anchor_key text,
      payload_hash text,
      submission_json jsonb not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `);
  await client.query('alter table zeko_relayer_submissions add column if not exists anchor_key text');
  await client.query('alter table zeko_relayer_submissions add column if not exists payload_hash text');
  await client.query("update zeko_relayer_submissions set anchor_key = submission_json ->> 'anchorKey', payload_hash = submission_json ->> 'payloadHash' where anchor_key is null or payload_hash is null");
  await client.query('create unique index if not exists zeko_relayer_submissions_anchor_key_uidx on zeko_relayer_submissions (anchor_key) where anchor_key is not null');
  await client.query('create unique index if not exists zeko_relayer_submissions_payload_hash_uidx on zeko_relayer_submissions (payload_hash) where payload_hash is not null');
  await client.query('create index if not exists zeko_relayer_submissions_created_at_idx on zeko_relayer_submissions (created_at desc)');

  const existingRole = await client.query('select 1 from pg_roles where rolname = $1', [username]);
  if (!existingRole.rowCount) {
    const roleLiteral = await client.query("select format('create role %I login password %L', $1, $2) as sql", [username, password]);
    await client.query(roleLiteral.rows[0].sql);
  }
  const passwordLiteral = await client.query("select format('alter role %I login password %L', $1, $2) as sql", [username, password]);
  await client.query(passwordLiteral.rows[0].sql);

  const role = quoteIdentifier(username);
  const database = quoteIdentifier(databaseName);
  await client.query(`alter role ${role} nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`);
  await client.query(`revoke all privileges on database ${database} from ${role}`);
  await client.query(`revoke all privileges on schema public from ${role}`);
  await client.query(`revoke all privileges on table mba_mission_registry_states from ${role}`);
  await client.query(`revoke all privileges on table zeko_relayer_submissions from ${role}`);
  await client.query(`grant connect on database ${database} to ${role}`);
  await client.query(`grant usage on schema public to ${role}`);
  await client.query(`grant select, insert, update on table mba_mission_registry_states to ${role}`);
  await client.query(`grant select, insert, update on table zeko_relayer_submissions to ${role}`);
  await client.query('commit');
  console.log(JSON.stringify({
    ok: true,
    username,
    tables: ['mba_mission_registry_states', 'zeko_relayer_submissions'],
    next: 'Construct a DATABASE_URL for this restricted role and set it only on magic-city-mba-relayer.'
  }));
} catch (error) {
  await client.query('rollback').catch(() => null);
  throw error;
} finally {
  await client.end();
}
