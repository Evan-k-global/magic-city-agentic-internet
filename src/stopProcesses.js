import process from 'node:process';
import { stopMagicCityProcesses } from './processControl.js';

const result = await stopMagicCityProcesses({
  log: (line) => process.stdout.write(`${line}\n`)
});

if (result.killed.length === 0 && result.remaining.length === 0) {
  process.stdout.write('[stop] no matching Magic City processes found\n');
} else if (result.remaining.length > 0) {
  process.stdout.write(`[stop] ${result.remaining.length} process(es) are still running\n`);
  process.exitCode = 1;
}
