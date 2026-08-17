import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'data');
const statePath = path.join(dataDir, 'state.json');
const backupsDir = path.join(dataDir, 'backups');

const emptyState = {
  agents: {},
  attestations: [],
  receipts: [],
  intents: [],
  balances: {},
  stakes: {},
  userAccounts: {},
  escrowLocks: {},
  ledger: [],
  payoutRequests: [],
  unitScale: 100,
  processedStripeEvents: {},
  payoutByTransferId: {}
};

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupsDir, { recursive: true });

if (fs.existsSync(statePath)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupsDir, `state-${stamp}.json`);
  fs.copyFileSync(statePath, backupPath);
  console.log(`backup_created=${backupPath}`);
}

fs.writeFileSync(statePath, `${JSON.stringify(emptyState, null, 2)}\n`);
console.log('state_reset=ok');
console.log('note=Local demo/testing state has been cleared.');
