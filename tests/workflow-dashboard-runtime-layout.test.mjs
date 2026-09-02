import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJiti } from '/Users/mliebreich/.local/share/pi-node/node-v22.22.2-darwin-arm64/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs';

function loadDashboardSource() {
  let source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');
  source = source.replace('import * as fs from "node:fs";\n', '');
  source = source.replace('import * as path from "node:path";\n', '');
  source = source.replace(/import \{ CONFIG_DIR_NAME, type ExtensionAPI, type ExtensionContext \} from "@earendil-works\/pi-coding-agent";\n/, '');
  source = source.replace(/import \{ truncateToWidth, visibleWidth \} from "@earendil-works\/pi-tui";\n/, '');
  source = `import * as fs from "node:fs";\nimport * as path from "node:path";\nconst CONFIG_DIR_NAME = ".pi";\nfunction stripAnsi(value: string): string { return value.replace(/\\x1b\\[[0-9;]*m/g, ""); }\nfunction visibleWidth(value: string): number { return stripAnsi(value).length; }\nfunction truncateToWidth(value: string, width: number, suffix = ""): string { return visibleWidth(value) <= width ? value : stripAnsi(value).slice(0, Math.max(0, width - suffix.length)) + suffix; }\n${source}`;
  const tmp = path.join(os.tmpdir(), `workflow-dashboard-runtime-${process.pid}-${Date.now()}.ts`);
  fs.writeFileSync(tmp, source);
  return tmp;
}

const jiti = createJiti(import.meta.url);
const extension = await jiti.import(loadDashboardSource(), { default: true });
const handlers = new Map();
const pi = {
  on(name, handler) { handlers.set(name, handler); },
  registerCommand() {},
  exec() { throw new Error('skip title enrichment'); },
};
extension(pi);

let widgetFactory;
let widgetSetCount = 0;
let renderRequestCount = 0;
const ctx = {
  cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-dashboard-runtime-cwd-')),
  signal: new AbortController().signal,
  hasUI: true,
  ui: {
    setWidget(_key, content) { widgetSetCount += 1; widgetFactory = content; },
    setStatus() {},
    notify() {},
  },
};

await handlers.get('session_start')({}, ctx);
await handlers.get('tool_result')({ content: [{ type: 'text', text: 'MAP #999: 0/1 closed, 1 open, 0 done this run, 1 running, 0 takeable, 0 blocked, 0 assigned, 0 unknown, 0 failed.' }] }, ctx);
assert.equal(widgetFactory, undefined, 'dashboard should ignore workflow-looking output until a workflow skill or agent starts');

await handlers.get('before_agent_start')({ prompt: '/skill:wayfinder-dispatcher Plan encrypted Sync Package export and import' }, ctx);
await handlers.get('tool_result')({ content: [{ type: 'text', text: 'MAP #227: 0/4 closed, 4 open, 0 done this run, 4 running, 0 takeable, 2 blocked, 0 assigned, 0 unknown, 0 failed.' }] }, ctx);

const theme = { fg(_color, value) { return value; } };
const tui = { requestRender() { renderRequestCount += 1; } };
const component = widgetFactory(tui, theme);
const lines = component.render(80);

const visibleBodyLine = lines[1].replace(/\x1b\[[0-9;]*m/g, '');
assert.match(visibleBodyLine, /\d\d:\d\d\s*│$/, 'elapsed timer should remain visible at the far right even in narrow terminals');
assert.doesNotMatch(visibleBodyLine, /0 takeable|0 assigned/, 'zero-value chips should be omitted to preserve room for the timer');

const widgetSetCountAfterMount = widgetSetCount;
await handlers.get('tool_result')({ content: [{ type: 'text', text: 'Newly spawned: #228 research — Check crypto APIs' }] }, ctx);
assert.equal(widgetSetCount, widgetSetCountAfterMount, 'dashboard should not re-register its widget after state-only updates');
assert.equal(renderRequestCount, 1, 'state-only updates should request a render from the mounted widget instead');

component.dispose();
console.log('workflow dashboard runtime layout ok');
