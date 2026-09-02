import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.match(source, /`\$\{c\.total\} sub-issues`/, 'status chips should include a dedicated total sub-issues label');
assert.match(source, /sub-issues/, 'total count should be labelled as sub-issues');
assert.match(source, /c\.total !== undefined/, 'total sub-issues chip should be derived from parsed total count');
assert.match(source, /if \(c\.total !== undefined\) parts\.push/, 'total sub-issues chip should be included with other chips');

console.log('workflow dashboard total sub-issues policy ok');
