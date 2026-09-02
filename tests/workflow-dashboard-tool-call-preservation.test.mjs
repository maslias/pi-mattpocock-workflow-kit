import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');
const fn = source.match(/function withTextContentShape\(message: any, text: string\): any \{[\s\S]*?\n\}/)?.[0] ?? '';

assert.ok(fn, 'withTextContentShape exists');
assert.doesNotMatch(fn, /content: typeof message\?\.content === "string" \? text : \[\{ type: "text", text \}\]/, 'sanitizing assistant text must not replace array content and drop tool-use parts');
assert.match(fn, /part\?\.type !== "text"/, 'sanitizing assistant text should preserve non-text content parts such as tool calls');
assert.match(fn, /content\.push\(part\)/, 'sanitizing assistant text should explicitly carry forward non-text parts');

console.log('workflow dashboard tool-call preservation policy ok');
