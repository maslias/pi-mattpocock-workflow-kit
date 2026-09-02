import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');
const fn = source.match(/function withTextContentShape\(message: any, text: string\): any \{[\s\S]*?\n\}/)?.[0] ?? '';

assert.ok(fn, 'withTextContentShape exists');
assert.match(fn, /for \(const part of message\.content\)/, 'sanitizing should preserve original content part order');
assert.match(fn, /content\.push\(part\)/, 'sanitizing should keep non-text parts in place');
assert.doesNotMatch(fn, /content: \[\.\.\.textParts, \.\.\.nonTextParts\]/, 'sanitizing must not move tool-use parts after text');

console.log('workflow dashboard message order policy ok');
