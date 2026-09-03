import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.match(source, /const DISALLOWED_NESTED_WORKFLOW_AGENTS = new Set\(\["wayfinder-dispatcher", "implement-dispatcher", "code-review-dispatcher", "to-pr-orchestrator"\]\);/, 'nested orchestrator/dispatcher agents should be guarded');
assert.match(source, /function disallowedNestedWorkflowAgent\(event: any\): string \| null/, 'guard helper should inspect subagent calls');
assert.match(source, /agent\.endsWith\("-dispatcher"\)/, 'guard should block every dispatcher agent, not just the bundled ones');
assert.match(source, /block: true/, 'guard should block unsafe nested workflow agent subagent calls');
assert.match(source, /Run \/skill:\$\{blockedAgent\} inline/, 'block reason should tell the agent to run the skill inline');

const requiredAgentsMatch = source.match(/const REQUIRED_AGENTS = \[([\s\S]*?)\];/);
assert.ok(requiredAgentsMatch, 'must define required agents');
const requiredAgents = requiredAgentsMatch[1];
for (const unsafe of ['to-pr-orchestrator', 'implement-dispatcher', 'code-review-dispatcher', 'wayfinder-dispatcher']) {
	assert.doesNotMatch(requiredAgents, new RegExp(`"${unsafe}"`), `${unsafe} should not be required as a spawnable leaf agent`);
}

console.log('nested dispatcher/orchestrator subagent guard ok');
