import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ARTIFACT_DIR = path.resolve(process.cwd(), 'data', 'execution-artifacts');
const ARTIFACT_ENCRYPTION_KEY_RAW = String(
  process.env.MAGIC_CITY_ARTIFACT_ENCRYPTION_KEY || process.env.MAGIC_CITY_STATE_ENCRYPTION_KEY || ''
).trim();
const REQUIRE_ARTIFACT_ENCRYPTION = String(
  process.env.MAGIC_CITY_REQUIRE_ARTIFACT_ENCRYPTION
  || (process.env.MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE === 'true' ? 'true' : 'false')
).toLowerCase() === 'true';
const MIGRATE_LEGACY_ARTIFACTS = process.env.MAGIC_CITY_MIGRATE_LEGACY_ARTIFACT_ENCRYPTION === 'true';

function decodeEncryptionKey(value = '') {
  if (!value) return null;
  const candidates = [Buffer.from(value, 'base64')];
  if (/^[0-9a-f]{64}$/i.test(value)) candidates.push(Buffer.from(value, 'hex'));
  const key = candidates.find((candidate) => candidate.length === 32);
  if (!key) throw new Error('invalid_magic_city_artifact_encryption_key');
  return crypto.createHash('sha256').update('magic-city-artifact-v1\0').update(key).digest();
}

const artifactEncryptionKey = decodeEncryptionKey(ARTIFACT_ENCRYPTION_KEY_RAW);

if (REQUIRE_ARTIFACT_ENCRYPTION && !artifactEncryptionKey) {
  throw new Error('magic_city_artifact_encryption_key_required');
}

function ensureArtifactDir() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  return ARTIFACT_DIR;
}

function safeSlug(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'artifact';
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function encryptArtifact(buffer) {
  if (!artifactEncryptionKey) return buffer;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', artifactEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.from(JSON.stringify({
    schema: 'magic-city-encrypted-artifact-v1',
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }), 'utf8');
}

function decryptArtifact(buffer) {
  let envelope;
  try {
    envelope = JSON.parse(buffer.toString('utf8'));
  } catch {
    if (REQUIRE_ARTIFACT_ENCRYPTION) throw new Error('unencrypted_execution_artifact_not_allowed');
    return buffer;
  }
  if (envelope?.schema !== 'magic-city-encrypted-artifact-v1') {
    if (REQUIRE_ARTIFACT_ENCRYPTION) throw new Error('unencrypted_execution_artifact_not_allowed');
    return buffer;
  }
  if (!artifactEncryptionKey) throw new Error('magic_city_artifact_encryption_key_required');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', artifactEncryptionKey, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ]);
  } catch (error) {
    throw new Error(`execution_artifact_decryption_failed:${error instanceof Error ? error.message : String(error)}`);
  }
}

function isEncryptedArtifact(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'))?.schema === 'magic-city-encrypted-artifact-v1';
  } catch {
    return false;
  }
}

function writeBufferAtomic(filePath, buffer) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, buffer);
  fs.renameSync(temporaryPath, filePath);
}

function contentTypeForExtension(extension = '') {
  switch (String(extension).toLowerCase()) {
    case '.md':
      return 'text/markdown; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.patch':
    case '.diff':
      return 'text/plain; charset=utf-8';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.ics':
      return 'text/calendar; charset=utf-8';
    case '.vcf':
      return 'text/vcard; charset=utf-8';
    case '.png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}

export function writeExecutionArtifact({
  sessionId,
  lane,
  label,
  extension = 'txt',
  content = ''
}) {
  const dir = ensureArtifactDir();
  const safeExtension = String(extension || 'txt').replace(/^\./, '') || 'txt';
  const fileName = `${safeSlug(sessionId)}-${safeSlug(lane)}-${safeSlug(label)}.${safeExtension}`;
  const filePath = path.join(dir, fileName);
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  writeBufferAtomic(filePath, encryptArtifact(buffer));
  return {
    label,
    fileName,
    filePath,
    url: `/artifacts/${encodeURIComponent(fileName)}`,
    contentType: contentTypeForExtension(`.${safeExtension}`),
    sha256: sha256Buffer(buffer)
  };
}

export function resolveExecutionArtifact(fileName = '') {
  const decoded = decodeURIComponent(String(fileName || ''));
  const safeName = path.basename(decoded);
  if (!safeName) return null;
  const filePath = path.join(ensureArtifactDir(), safeName);
  if (!filePath.startsWith(ARTIFACT_DIR)) return null;
  if (!fs.existsSync(filePath)) return null;
  const storedContent = fs.readFileSync(filePath);
  return {
    fileName: safeName,
    filePath,
    contentType: contentTypeForExtension(path.extname(safeName)),
    content: decryptArtifact(storedContent)
  };
}

export function migrateLegacyExecutionArtifacts() {
  if (!MIGRATE_LEGACY_ARTIFACTS || !artifactEncryptionKey) return { migrated: 0, skipped: 0 };
  const directory = ensureArtifactDir();
  let migrated = 0;
  let skipped = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.includes('.tmp')) continue;
    const filePath = path.join(directory, entry.name);
    const content = fs.readFileSync(filePath);
    if (isEncryptedArtifact(content)) {
      skipped += 1;
      continue;
    }
    writeBufferAtomic(filePath, encryptArtifact(content));
    migrated += 1;
  }
  return { migrated, skipped };
}
