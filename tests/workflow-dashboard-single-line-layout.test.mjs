import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.match(source, /title\?: string;/, 'workflow runs should store an optional issue title');
assert.match(source, /function parseTitleLine\(line: string\)/, 'dashboard should parse final snapshot title lines');
assert.match(source, /Final snapshot — #/, 'dashboard should recognize final snapshot lines');
assert.match(source, /function displayTitle\(run: WorkflowRun\): string/, 'dashboard should choose title fallback for left side');
assert.match(source, /function statusChips\(run: WorkflowRun, maxWidth = Number\.POSITIVE_INFINITY\): string/, 'dashboard should render compact status chips');
assert.match(source, /`\$\{Number\(value\)\} \$\{key\}`/, 'status chips should include counted labels such as running when present');
assert.match(source, /assigned/, 'status chips should include assigned counts when present');
assert.match(source, /borderLine\(left, infoText\(` \$\{statusChips\(run, maxRightWidth - 2\)\} `\), width, accent\)/, 'dashboard body should be a single title-left/status-right line');
assert.doesNotMatch(source, /runLine\(run\)/, 'dashboard should not render a separate current-run row');
assert.doesNotMatch(source, /for \(const event of run\.events/, 'dashboard should not render bulky event rows in compact layout');

console.log('workflow dashboard single-line layout policy ok');
