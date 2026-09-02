import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.match(source, /theme\.fg\("thinkingXhigh", value\)/, 'workflow box frame/header should use pink-lila thinkingXhigh');
assert.match(source, /const INFO_TEXT_FG = "\\x1b\[38;2;255;255;255m";/, 'inside info text should use explicit true white #ffffff');
assert.match(source, /function infoText\(value: string\): string/, 'dashboard should have a dedicated white info text helper');
assert.match(source, /const left = infoText\(` \$\{displayTitle\(run\)\} `\);/, 'inside title text should use clean white');
assert.match(source, /infoText\(` \$\{statusChips\(run, maxRightWidth - 2\)\} `\)/, 'inside status text should use clean white');
assert.doesNotMatch(source, /theme\.fg\("dim", ` \$\{statusChips\(run\)\} `\)/, 'status chips should not be dimmed');

console.log('workflow dashboard color policy ok');
