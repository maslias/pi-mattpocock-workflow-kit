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
  const tmp = path.join(os.tmpdir(), `workflow-dashboard-code-review-start-${process.pid}-${Date.now()}.ts`);
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
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-dashboard-code-review-cwd-'));
fs.mkdirSync(path.join(cwd, '.pi', 'mattpocock-workflow'), { recursive: true });
fs.writeFileSync(path.join(cwd, '.pi', 'mattpocock-workflow', 'status.json'), JSON.stringify({
  version: 1,
  updatedAt: new Date().toISOString(),
  runs: [{
    id: '2pr-branch-implement/issue-244-spec-release-1-3-2-global-utilities-and-procedures',
    kind: '2pr',
    scope: 'implement/issue-244-spec-release-1-3-2-global-utilities-and-procedures',
    status: 'running',
    phase: 'branch',
    startedAt: new Date().toISOString(),
    summary: 'BRANCH: implement/issue-244-spec-release-1-3-2-global-utilities-and-procedures created from main.',
    counts: {},
    events: [],
    updatedAt: new Date().toISOString(),
  }],
  warnings: [],
}, null, 2));

const ctx = {
  cwd,
  signal: new AbortController().signal,
  hasUI: true,
  ui: {
    setWidget(_key, content) { widgetFactory = content; },
    setStatus() {},
    notify() {},
  },
};

await handlers.get('session_start')({}, ctx);
await handlers.get('before_agent_start')({ prompt: '/skill:code-review-dispatcher continue with #244' }, ctx);
await handlers.get('tool_call')({ toolName: 'subagent', input: { name: 'code-review-worker #244 iter-1', agent: 'code-review-worker' } }, ctx);

assert.ok(widgetFactory, 'dashboard should render when code-review dispatcher starts its review worker');
const theme = { fg(_color, value) { return value; } };
const component = widgetFactory({ requestRender() {} }, theme);
const topLine = component.render(120)[0].replace(/\x1b\[[0-9;]*m/g, '');
assert.match(topLine, /code-review dispatcher · SPEC #244/, 'headline should switch from stale create branch run to active code-review dispatcher');
assert.doesNotMatch(topLine, /create branch/, 'headline should not remain on the previous to-pr branch phase');
component.dispose();
console.log('workflow dashboard code-review dispatcher start ok');
