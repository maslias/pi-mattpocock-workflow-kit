import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.match(source, /startedAt\?: string;/, 'workflow runs should store a startedAt timestamp');
assert.match(source, /let activeRunIdsThisSession = new Set<string>\(\);/, 'run timers should reset per Pi session');
assert.match(source, /function formatElapsed\(run: WorkflowRun\): string \| undefined/, 'dashboard should format an elapsed timer');
assert.match(source, /\[\.\.\.parts, elapsed\]/, 'elapsed timer should be appended to the right-side status chips');
assert.match(source, /function startDashboardTimer\(requestRender: \(\) => void\): void/, 'dashboard should start a render timer while visible');
assert.match(source, /function stopDashboardTimer\(\): void/, 'dashboard should stop its render timer when hidden/shutdown');
assert.match(source, /setInterval\(\(\) => requestDashboardRender\?\.\(\), 1000\)/, 'dashboard should refresh the timer every second without re-registering the widget');
assert.match(source, /pi\.on\("session_shutdown"/, 'dashboard should clean up timer on session shutdown');

console.log('workflow dashboard timer policy ok');
