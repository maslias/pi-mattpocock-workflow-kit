import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.match(source, /enabled\?: boolean/, 'dashboard config should support an enabled flag');
assert.match(source, /function isDashboardEnabled\(ctx: ExtensionContext\): boolean/, 'dashboard should have a central enabled guard');
assert.match(source, /function setDashboardEnabled\(ctx: ExtensionContext, enabled: boolean\)/, 'command should persist dashboard enabled state');
assert.match(source, /!isDashboardEnabled\(ctx\)/, 'render path should clear the widget/status when dashboard is disabled');
assert.match(source, /const command = _args\.trim\(\)\.toLowerCase\(\)/, 'workflow-dashboard command should parse subcommands');
assert.match(source, /command === "off" \|\| command === "disable"/, 'workflow-dashboard command should support off/disable');
assert.match(source, /command === "on" \|\| command === "enable"/, 'workflow-dashboard command should support on/enable');
assert.match(source, /command === "toggle"/, 'workflow-dashboard command should support toggle');
assert.match(source, /Workflow dashboard disabled/, 'command should notify when disabled');
assert.match(source, /Workflow dashboard enabled/, 'command should notify when enabled');
assert.match(source, /if \(!isDashboardEnabled\(ctx\)\) return;/, 'ingest hooks should no-op while dashboard is disabled');

console.log('workflow dashboard toggle policy ok');
