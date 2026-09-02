import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.match(source, /function issueNumberFromScope\(scope: string\): string \| undefined/, 'dashboard should extract issue numbers from MAP/SPEC scopes');
assert.match(source, /async function enrichMissingTitles\(pi: ExtensionAPI, ctx: ExtensionContext\)/, 'dashboard should enrich missing titles from GitHub');
assert.match(source, /gh", \["issue", "view", issueNumber, "--json", "title", "--jq", "\.title"\]/, 'dashboard should fetch issue title via gh issue view');
assert.match(source, /if \(title && !run\.title\) run\.title = title;/, 'dashboard should populate missing non-empty run title');
assert.match(source, /await enrichMissingTitles\(pi, ctx\);/, 'dashboard should enrich titles before rendering after ingest');

console.log('workflow dashboard title enrichment policy ok');
