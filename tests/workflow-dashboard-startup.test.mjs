import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('extensions/mattpocock-workflow-dashboard/index.ts', 'utf8');

assert.match(source, /let visibleThisSession = false;/, 'dashboard visibility should be session-local, not driven by persisted status alone');
assert.match(source, /function markDashboardVisible\(\): void/, 'ingesting live workflow output should explicitly activate the dashboard for this session');
assert.match(source, /let workflowActiveThisSession = false;/, 'dashboard should track workflow entrypoint activation separately from visibility');
assert.match(source, /return workflowActiveThisSession && visibleThisSession && state\.runs\.length > 0;/, 'persisted runs must not make the dashboard active on startup');

const sessionStart = source.match(/pi\.on\("session_start", async \(_event, ctx\) => \{[\s\S]*?\n\t\}\);/)?.[0] ?? '';
assert.ok(sessionStart, 'must have a session_start handler');
assert.match(sessionStart, /visibleThisSession = false;/, 'new sessions should reset session-local dashboard visibility');
assert.match(sessionStart, /workflowActiveThisSession = false;/, 'new sessions should reset workflow activation');
assert.doesNotMatch(sessionStart, /renderDashboard\(ctx\)/, 'session_start must not render stale persisted workflow runs');
assert.match(sessionStart, /clearDashboard\(ctx\)/, 'session_start should clear any stale widget/status');

const beforeAgentStartHook = source.match(/pi\.on\("before_agent_start", async \(event, ctx\) => \{[\s\S]*?\n\t\}\);/)?.[0] ?? '';
assert.match(beforeAgentStartHook, /workflowSkillIsActive\(event\)/, 'workflow skills should activate the dashboard');
assert.match(beforeAgentStartHook, /deactivateWorkflowDashboard\(ctx\)/, 'non-workflow turns should clear the dashboard');

const toolCallHook = source.match(/pi\.on\("tool_call", async \(event\) => \{[\s\S]*?\n\t\}\);/)?.[0] ?? '';
assert.match(toolCallHook, /workflowAgentIsStarting\(event\)/, 'workflow subagents should activate the dashboard');

const messageHook = source.match(/pi\.on\("message_end", async \(event, ctx\) => \{[\s\S]*?\n\t\}\);/)?.[0] ?? '';
assert.match(messageHook, /workflowActiveThisSession && text && ingestText\(text\)/, 'assistant workflow output should only activate visibility after a workflow entrypoint');

const toolHook = source.match(/pi\.on\("tool_result", async \(event, ctx\) => \{[\s\S]*?\n\t\}\);/)?.[0] ?? '';
assert.match(toolHook, /!isDashboardEnabled\(ctx\) \|\| !workflowActiveThisSession/, 'tool workflow output should be ignored without a workflow entrypoint');

console.log('workflow dashboard startup visibility policy ok');
