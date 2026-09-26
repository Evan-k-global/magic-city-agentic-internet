import fs from 'node:fs';
import path from 'node:path';
import { validateDeployment } from './deploymentSecurity.js';

// Run before modules that capture environment-dependent storage settings.
for (const file of ['.env', 'env/providers.env', 'env/stripe.env', 'env/square.env', 'env/google.env', 'env/github.env']) {
  let raw;
  try { raw = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'); } catch { continue; }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
  }
}
validateDeployment();
