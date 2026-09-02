import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.match(source, /function titleInfo\(run: WorkflowRun\): string/, 'title should own dispatcher/orchestrator plus scope identity');
assert.match(source, /function displayTitle\(run: WorkflowRun\): string/, 'run row should avoid repeating title identity');
assert.doesNotMatch(source, /` \$\{icon\} \$\{runLabel\(run\)\}\$\{phase\} · \$\{run\.scope\} `/, 'run row must not duplicate dispatcher label and scope already shown in title');
assert.doesNotMatch(source, /`   \$\{runLabel\(run\)\}: \$\{compactSummary\(run\)\} `/, 'summary row must not duplicate dispatcher label already shown above');
assert.match(source, /displayTitle\(run\)/, 'run row should use compact unique title line');
assert.match(source, /statusChips\(run\)/, 'run row should show summary only as right-aligned chips');

console.log('workflow dashboard no duplicate labels policy ok');
