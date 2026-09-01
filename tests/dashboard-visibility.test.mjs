import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.match(source, /function isDashboardActive\(/, 'dashboard must have an explicit active/inactive guard');
assert.match(source, /ctx\.ui\.setWidget\(EXTENSION_ID, undefined\)/, 'inactive dashboard must clear the editor widget');
assert.match(source, /ctx\.ui\.setStatus\(EXTENSION_ID, undefined\)/, 'inactive dashboard must clear the footer status');
assert.doesNotMatch(source, /No workflow status detected yet\./, 'inactive dashboard must not render a no-status placeholder');

console.log('dashboard inactive visibility policy ok');
