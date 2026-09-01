---
name: implement-dispatcher
description: Dispatch a SPEC issue to parallel implement worker subagents until every ready sub-issue is implemented.
disable-model-invocation: true
---

Dispatch one GitHub SPEC issue to `/skill:implement` worker subagents. The input is a GitHub issue number or URL for a SPEC/tracking issue whose sub-issues are implementation tickets. Keep the branch choice outside this skill: the human starts on the implementation branch before invoking the dispatcher.

The dispatcher owns orchestration only: find takeable sub-issues, create isolated worktrees, spawn implement workers, merge completed work back into the current implementation branch, then repeat until no implementable sub-issues remain. The implement worker owns implementation, TDD/tests, resolution comment, closing its sub-issue, and committing its work. Code review is deliberately out of scope for this dispatcher run.

## Dispatch rules

- Spawn workers with fresh context: every `subagent` call sets `fork: false`.
- Session names include agent name and issue number: `implement-worker #<ticket>`.
- A takeable ticket is open, has `ready-for-agent`, is unassigned, and is not blocked.
- A blocked ticket has a blocker label (`blocked`, `blocked:*`, `blocked-by:*`, `depends-on:*`, or another project blocker label), or native dependency metadata/fallback body text showing open blockers.
- Skip closed, assigned, blocked, and not-ready tickets. Re-check them after every successful merge because labels/blockers may change.
- Create one git worktree and one branch per spawned ticket under `.agent-tmp/implement-dispatcher/worktrees/spec-<spec>/issue-<ticket>/`. Workers never share a working tree.
- Merge each completed worker branch into the original implementation branch before spawning tickets that were previously blocked by it.
- Do not run an extra code review or close the SPEC issue. That belongs to a later review/closure dispatcher.
- Do not run extra dispatcher-level tests. `/skill:implement` runs TDD/tests and commits.
- Never poll subagent logs. After spawning a wave, wait for the harness-delivered subagent results.
- Maintain a compact running summary after every classification, spawn wave, and merge batch so the human can see progress without reading worker logs.

## Steps

1. **Normalize the SPEC id.** Accept a bare number, `#<number>`, or GitHub issue URL. Extract the issue number and repository owner/name. If the URL omits nothing, use that repo; otherwise use the current `gh repo view --json nameWithOwner` repo.

2. **Record the integration branch.** Capture `git branch --show-current`, repository root, and `git status --short`. If the working tree is dirty, stop and ask the human to start from a clean manually-created implementation branch. If `.agent-tmp/` is not ignored by git, warn the human in the running summary; do not edit `.gitignore` automatically.

3. **Load the SPEC.** Run `gh issue view <spec> --repo <owner/repo> --json number,title,state,labels,body,url`. Stop if the SPEC is closed or cannot be read.

4. **Find sub-issues.** Prefer GitHub native sub-issues if available. If the repo/API does not expose sub-issues, use the fallback conventions:
   - child body contains `Parent` followed by `#<spec>`;
   - child body contains `Part of #<spec>`;
   - issue search for `<spec> in:body` and verify the parent marker.

   For each child, collect number, title, url, state, labels, assignees, body, and blocking summary if available.

5. **Classify children.** For every child ticket:
   - `closed` if the issue is closed.
   - `assigned` if open and assignees are present.
   - `blocked` if open and a blocker label is present, native dependency summary reports open blockers, or fallback `Blocked by: #...` names any issue that is still open.
   - `not-ready` if open and it lacks `ready-for-agent`.
   - `takeable` if open, unassigned, unblocked, and `ready-for-agent`.

6. **Spawn one wave.** For every currently takeable ticket that has not already been spawned:
   - Create branch `implement/spec-<spec>/issue-<ticket>` from the integration branch.
   - Create worktree `.agent-tmp/implement-dispatcher/worktrees/spec-<spec>/issue-<ticket>/` for that branch.
   - Call `subagent` with:
     - `name`: `implement-worker #<ticket>`
     - `agent`: `implement-worker`
     - `interactive`: `false`
     - `fork`: `false`
     - `cwd`: the worktree path
     - `task`: `Run /skill:implement for SPEC #<spec>, sub-issue #<ticket> (<url>). Work only this ticket. Use TDD/tests as the implement skill instructs. Skip code review in this dispatcher run; a later review dispatcher owns review. Commit your work in this worktree branch. Post the resolution comment and close sub-issue #<ticket> when implementation is complete. As soon as sub-issue #<ticket> is implemented, committed, commented, and closed, give a compact final summary and immediately call subagent_done; do not wait for more input. Do not modify or close SPEC #<spec>.`

7. **Integrate completed workers.** When the harness delivers a worker result:
   - Inspect the worker worktree status and recent commits.
   - If the worker reports failure, has no implementation commit, or left the worktree dirty, mark the ticket failed and continue integrating other successful workers.
   - On the integration branch, merge the worker branch with `git merge --no-ff <branch>`.
   - If merge conflicts occur, run `/skill:resolving-merge-conflicts` immediately and use it to resolve the in-progress merge. After resolving, continue the merge/commit and then continue dispatcher integration. If the conflict-resolution skill cannot resolve the merge safely, stop with the conflict details and the remaining ticket states. Do not spawn more workers until the merge conflict is resolved.
   - After a successful merge, remove the worker worktree if safe. If `.agent-tmp/implement-dispatcher/worktrees/spec-<spec>/` and its parent workflow temp directories become empty, remove those empty directories too.

8. **Publish a running summary.** After every classification, spawn wave, and merge batch, report one compact line plus changed tickets only:
   - `SPEC #<spec>: <closed>/<total> closed, <open> open, <merged> merged this run, <running> running, <takeable> takeable, <blocked> blocked, <assigned> assigned, <not-ready> not-ready, <failed> failed.`
   - Newly spawned: `#<ticket> — <title>`.
   - Newly merged: `#<ticket> — <title>`.
   - Newly discovered: `#<ticket> — <title>`.
   - Newly unblocked/takeable: `#<ticket> — <title>`.
   - New failures/conflicts only when present, including whether `/skill:resolving-merge-conflicts` resolved an integration conflict.

9. **Loop.** After each successful merge batch, reload the SPEC and all child tickets, then classify again. Spawn the next wave of newly takeable tickets. Continue until no open child ticket is takeable.

10. **Report the final snapshot.** Keep it compact:
   - SPEC number and title.
   - Counts: total child tickets, closed, open, merged, failed, blocked, assigned, not-ready.
   - Merged ticket list: `#<ticket> — <title>`.
   - Remaining ticket list grouped by reason.
   - Current branch and merge status.
   - Worktree cleanup status.

Completion criterion: every currently takeable `ready-for-agent` sub-issue has been spawned exactly once, every successful worker branch has been merged into the original implementation branch, successful worker worktrees under `.agent-tmp/implement-dispatcher/worktrees/spec-<spec>/` have been removed, empty workflow temp directories have been cleaned up when safe, the running summary is current, no dispatcher-level tests/review/SPEC closure were performed, and remaining open tickets are accounted for by blocked/assigned/not-ready/failed status.
