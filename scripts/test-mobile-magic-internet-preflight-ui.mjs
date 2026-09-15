import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function extractFunctionSource(name) {
  const start = html.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing inline function ${name}`);
  const braceStart = html.indexOf('{', html.indexOf(') {', start));
  let depth = 0;
  for (let index = braceStart; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`unterminated inline function ${name}`);
}

const mobileCheckSource = extractFunctionSource('isMobileRunnerUnsupported');
function checkMobile(userAgent, maxTouchPoints = 0) {
  const context = vm.createContext({ navigator: { userAgent, maxTouchPoints } });
  vm.runInContext(`${mobileCheckSource}\nthis.result = isMobileRunnerUnsupported();`, context);
  return context.result;
}

assert.equal(checkMobile('Mozilla/5.0 (Linux; Android 16; Pixel 9) Mobile'), true);
assert.equal(checkMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Mobile'), true);
assert.equal(checkMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), true);
assert.equal(checkMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0.0.0', 0), false);

assert.match(html, /mobileRunnerUnsupported = magicInternetAction && isMobileRunnerUnsupported\(\)/);
assert.match(html, /Account Setup Step Needed\\n\\nTo continue: Open Magic City in desktop Chrome/);
assert.match(html, /Desktop Chrome required/);
assert.match(html, /mobileRunnerUnsupported[\s\S]{0,500}action-required-surface">Continue on desktop Chrome/);
assert.match(html, /<svg class="send-icon" viewBox="0 0 24 24"/);
assert.match(html, /<path d="M12 19V5"><\/path>[\s\S]*<path d="M5 12l7-7 7 7"><\/path>/);
assert.doesNotMatch(html, /#sendBtn::after\s*\{[\s\S]{0,200}content:\s*["']↑["']/);

console.log('mobile Magic Internet preflight and send icon ok');
