import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.match(source, /alert\?: string;/, 'workflow runs should store an optional alert line');
assert.match(source, /function parseAlertLine\(line: string\): string \| null/, 'dashboard should parse important warning/error/blocker lines');
assert.match(source, /No takeable child tickets remain/, 'no-takeable dispatcher message should be considered important');
assert.match(source, /blocked/i, 'blocked messages should be considered important');
assert.match(source, /manual gate/i, 'manual gate messages should be considered important');
assert.match(source, /run\.alert = alert;/, 'ingest should store alert on current run');
assert.match(source, /if \(run\.alert\) lines\.push/, 'render should show alert as an extra line inside the box');
assert.match(source, /infoText\(` ! \$\{run\.alert\} `\)/, 'alert line should render inside the white info box');

console.log('workflow dashboard alert line policy ok');
