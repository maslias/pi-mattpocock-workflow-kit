import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.doesNotMatch(source, /External prerequisites:/, 'dashboard must not show generic external prerequisite warning');

const countBranch = source.match(/const count = parseCountLine\(line\);[\s\S]*?continue;\n\t\t}/)?.[0] ?? '';
assert.ok(countBranch, 'must ingest count lines');
assert.doesNotMatch(countBranch, /addEvent\(run, line\)/, 'count summaries should update run.summary/counts, not duplicate themselves as workflow events');

assert.match(source, /function parseWorkflowEventLine\(/, 'dashboard must ingest workflow event lines');
assert.match(source, /function sanitizeWorkflowText\(/, 'workflow-owned lines should be removable from assistant transcript');
assert.match(source, /message: withTextContentShape\(message, sanitized\)/, 'assistant message should be replaced with sanitized workflow text');
assert.match(source, /statusChips\(run\)/, 'dashboard should render compact status chips as the canonical count summary');

console.log('workflow dashboard noise policy ok');
