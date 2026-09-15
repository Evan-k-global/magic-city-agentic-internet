import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');

const runnerSection = html.match(/<details id="settingsNativeRunnerSection">([\s\S]*?)<details id="settingsSoundtrackSection">/)?.[1] || '';
const soundtrackIndex = html.indexOf('<details id="settingsSoundtrackSection">');
const retailBetaIndex = html.indexOf('<div class="agent-deploy-card" id="settingsRetailBetaCard">');
const sidebarEndIndex = html.indexOf('</aside>', retailBetaIndex);
assert.doesNotMatch(runnerSection, /Retail beta/, 'retail beta explainer must remain visible when Runner is collapsed');
assert.ok(soundtrackIndex >= 0 && retailBetaIndex > soundtrackIndex && sidebarEndIndex > retailBetaIndex, 'retail beta explainer must sit below Soundtrack and outside the accordions');
const retailBetaCard = html.slice(retailBetaIndex, sidebarEndIndex);
assert.match(retailBetaCard, /Retail beta/);
assert.match(retailBetaCard, /hosted shopping agent currently completes purchases through Amazon/i);
assert.match(retailBetaCard, /local or cloud model intelligence/i);
assert.match(
  retailBetaCard,
  /href="https:\/\/github\.com\/zeko-labs\/magic-city-agentic-internet\/blob\/main\/docs\/partner-white-label-quickstart\.md"/
);
assert.match(retailBetaCard, />Developer integration guide<\/a>/);

console.log('retail beta settings UI ok');
