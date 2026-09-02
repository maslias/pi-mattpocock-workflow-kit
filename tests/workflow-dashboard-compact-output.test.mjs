import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.match(source, /function runLabel\(run: WorkflowRun\): string/, 'dashboard should render a human dispatcher/orchestrator label');
assert.match(source, /wayfinder dispatcher/, 'wayfinder runs should be labelled as dispatcher runs');
assert.match(source, /implementation dispatcher/, 'implementation runs should be labelled as dispatcher runs');
assert.match(source, /code-review dispatcher/, 'code-review runs should be labelled as dispatcher runs');
assert.match(source, /to-spec/, 'orchestrator spec phase should be labelled as to-spec');
assert.match(source, /to-tickets/, 'orchestrator ticket phase should be labelled as to-tickets');
assert.match(source, /"MAP complete", "creating SPEC"/, 'to-spec status should show map completion and spec creation');
assert.match(source, /`\$\{c\.tickets\} tickets`.*"creating"/, 'to-tickets status should show created ticket count when known');
assert.match(source, /function statusChips\(run: WorkflowRun, maxWidth = Number\.POSITIVE_INFINITY\): string/, 'dashboard should compact verbose count summaries');
assert.match(source, /titleInfo\(active\)/, 'title should include label plus scope');
assert.match(source, /statusChips\(run, maxRightWidth - 2\)/, 'body should include compact status chips sized to the row');
assert.doesNotMatch(source, /ctx\.ui\.setStatus\(EXTENSION_ID, status \? ctx\.ui\.theme\.fg\("accent", status\) : undefined\)/, 'dashboard should not write the footer status line');
assert.match(source, /const MAX_EVENTS = 3;/, 'dashboard should show fewer events');
assert.match(source, /function normalizeWorkflowEventLine/, 'dashboard should normalize bulky workflow event labels');
assert.match(source, /"Newly spawned": "spawned"/, 'newly spawned events should be compact');

console.log('workflow dashboard compact output policy ok');
