import assert from 'node:assert/strict';
import fs from 'node:fs';

const skill = fs.readFileSync(new URL('../skills/implement-dispatcher/SKILL.md', import.meta.url), 'utf8');

assert.match(
  skill,
  /resolve the worker worktree path from the repository root/i,
  'dispatcher must resolve worker worktree paths from git repo root, not process cwd or HOME',
);

assert.match(
  skill,
  /git worktree add \.agent-tmp\/implement-dispatcher\/worktrees\/spec-<spec>\/issue-<ticket>/,
  'dispatcher should specify the exact in-repo .agent-tmp git worktree add path',
);

assert.match(
  skill,
  /never create sibling worktrees/i,
  'dispatcher must explicitly forbid sibling HOME worktrees like ~/repo-issue-123',
);

assert.match(
  skill,
  /git worktree remove .*issue-<ticket>/,
  'dispatcher must specify git worktree remove cleanup for successful workers',
);

assert.match(
  skill,
  /cleanup failure/i,
  'dispatcher must report cleanup failures instead of silently leaving stale worktrees',
);

console.log('implement-dispatcher worktree contract ok');
