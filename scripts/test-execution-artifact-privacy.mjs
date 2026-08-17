import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-artifact-privacy-'));
const secretText = 'private search: nature valley granola bars under four dollars';

try {
  process.chdir(tmpDir);
  process.env.MAGIC_CITY_STATE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  process.env.MAGIC_CITY_REQUIRE_ARTIFACT_ENCRYPTION = 'true';
  process.env.MAGIC_CITY_MIGRATE_LEGACY_ARTIFACT_ENCRYPTION = 'true';

  const artifactDirectory = path.join(tmpDir, 'data', 'execution-artifacts');
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.writeFileSync(path.join(artifactDirectory, 'cs-legacy-browser-private.md'), secretText);

  const artifacts = await import(`${pathToFileURL(path.join(rootDir, 'src', 'executionArtifacts.js')).href}?privacy-test=${Date.now()}`);
  const migration = artifacts.migrateLegacyExecutionArtifacts();
  if (migration.migrated !== 1) throw new Error(`legacy_artifact_migration_failed:${JSON.stringify(migration)}`);

  const migratedRaw = fs.readFileSync(path.join(artifactDirectory, 'cs-legacy-browser-private.md'), 'utf8');
  if (migratedRaw.includes(secretText)) throw new Error('legacy_artifact_remained_plaintext');
  const migrated = artifacts.resolveExecutionArtifact('cs-legacy-browser-private.md');
  if (!migrated || migrated.content.toString('utf8') !== secretText) throw new Error('legacy_artifact_decryption_failed');

  const created = artifacts.writeExecutionArtifact({
    sessionId: 'cs-2',
    lane: 'browser',
    label: 'private-search',
    extension: 'md',
    content: secretText
  });
  const createdRaw = fs.readFileSync(created.filePath, 'utf8');
  if (createdRaw.includes(secretText)) throw new Error('new_artifact_remained_plaintext');
  const resolved = artifacts.resolveExecutionArtifact(created.fileName);
  if (!resolved || resolved.content.toString('utf8') !== secretText) throw new Error('new_artifact_decryption_failed');

  console.log('execution artifact privacy regression passed');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
