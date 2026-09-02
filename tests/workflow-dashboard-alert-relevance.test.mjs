import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.match(source, /const count = parseCountLine\(line\);[\s\S]*?const alert = parseAlertLine\(line\);/, 'count summaries must be handled before alert parsing so "0 blocked" does not become an alert');
assert.match(source, /if \(count\) \{[\s\S]*?run\.alert = undefined;/, 'fresh count summaries should clear stale alerts');
assert.match(source, /No takeable child tickets remain/, 'explicit no-takeable terminal messages should still be alerts');
assert.match(source, /if \(Number\(value\) > 0\) parts\.push/, 'count chips should only be shown when non-zero');
assert.doesNotMatch(source, /alwaysShowKeys/, 'zero-value chips should not crowd out the elapsed timer');

console.log('workflow dashboard alert relevance policy ok');
