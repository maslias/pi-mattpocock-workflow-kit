import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.match(source, /function isStructuredDataLine\(line: string\): boolean/, 'dashboard should identify structured JSON/array output before alert parsing');
assert.match(source, /if \(isStructuredDataLine\(line\)\) return null;/, 'structured output must not become the alert line just because it contains blocked/error words');
assert.match(source, /\.startsWith\("\[\{"\)/, 'compact JSON arrays like GitHub issue result lists should be treated as structured noise');

console.log('workflow dashboard structured alert noise policy ok');
