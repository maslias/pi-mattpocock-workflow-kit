---
name: wayfinder-dispatcher
description: Dispatch a Wayfinder map issue to Wayfinder worker subagents until no takeable child tickets remain.
disable-model-invocation: true
---

Dispatch one Wayfinder map issue to `/skill:wayfinder` worker subagents. The input is a GitHub issue number or URL for a `wayfinder:map` issue. The dispatcher owns orchestration only: inspect the map's child tickets, spawn takeable tickets, wait for harness-delivered worker results, reload the map because workers may create more tickets, then repeat until no takeable child tickets remain.

## Dispatch rules

- Spawn workers with fresh context: every `subagent` call sets `fork: false`.
- Session names include agent name, issue number, and type:
  - AFK worker: `wayfinder-worker #<ticket> <type>`
  - HITL worker: `wayfinder-worker-interactive #<ticket> <type>`
  - Dispatcher agent, when spawned elsewhere: `wayfinder-dispatcher #<map> map`
- HITL labels: `wayfinder:prototype`, `wayfinder:grilling`.
- AFK labels: `wayfinder:research`, `wayfinder:task`.
- A takeable ticket is open, unblocked, and unassigned. Skip assigned or blocked tickets.
- If a ticket has no known `wayfinder:<type>` label, skip it and report `unknown label`.
- Track spawned tickets so a still-running or already-finished ticket is never spawned twice.
- Maintain a compact running summary after every classification, spawn wave, and completed worker batch so the human can see progress without reading worker logs.
- Never poll subagent logs. After spawning a wave, wait for the harness-delivered subagent results.

## Steps

1. **Normalize the map id.** Accept a bare number, `#<number>`, or GitHub issue URL. Extract the issue number and repository owner/name. If the URL names a repo, use it; otherwise use the current `gh repo view --json nameWithOwner` repo.

2. **Load the map.** Run `gh issue view <map> --repo <owner/repo> --json number,title,state,labels,body,url` and verify it has `wayfinder:map`. If not, stop and report the mismatch.

3. **Find child tickets.** Prefer GitHub native sub-issues if available. If the repo/API does not expose sub-issues, use the fallback convention: issues whose body contains `Part of #<map>`. Include both open and closed children when counting.

   For each child, collect: number, title, url, state, labels, assignees, and blocking summary if available.

4. **Classify children.** For every child ticket:
   - Type is the first label matching `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`, stripped to `research`, `prototype`, `grilling`, or `task`.
   - Status is `closed` if the issue is closed.
   - Status is `assigned` if open and assignees are present.
   - Status is `blocked` if open and native dependency summary reports open blockers, or the fallback `Blocked by: #...` line names any issue that is still open.
   - Status is `unknown` if open and no known `wayfinder:<type>` label exists.
   - Status is `running` if open and this dispatcher already spawned a worker for it whose result has not arrived.
   - Status is `done-this-run` if this dispatcher spawned a worker for it and the worker finished successfully.
   - Status is `failed` if this dispatcher spawned a worker for it and the worker reported failure.
   - Status is `takeable` if open, unassigned, unblocked, known-type, and not already running/done/failed in this dispatcher run.

5. **Publish a running summary.** After every classification, spawn wave, and completed worker batch, report one compact line plus changed tickets only:
   - `MAP #<map>: <closed>/<total> closed, <open> open, <done> done this run, <running> running, <takeable> takeable, <blocked> blocked, <assigned> assigned, <unknown> unknown, <failed> failed.`
   - Newly spawned: `#<ticket> <type> — <title>`.
   - Newly done: `#<ticket> <type> — <title>`.
   - Newly discovered: `#<ticket> <type> — <title>`.
   - Newly unblocked/takeable: `#<ticket> <type> — <title>`.
   - New failures only when present.

6. **Spawn one wave.** For every currently takeable ticket:
   - If type is `prototype` or `grilling`, call `subagent` with:
     - `name`: `wayfinder-worker-interactive #<ticket> <type>`
     - `agent`: `wayfinder-worker-interactive`
     - `interactive`: `true`
     - `fork`: `false`
     - `task`: `Run /skill:wayfinder for map #<map>, ticket #<ticket> (<type>). Work only this ticket. /skill:wayfinder owns resolution, closing the issue, and updating the map. As soon as /skill:wayfinder has posted the resolution comment and closed or otherwise dispositioned ticket #<ticket>, give a compact final summary and immediately call subagent_done; do not wait for more input. The dispatcher may continue after you finish because Wayfinder sessions can create more tickets.`
   - If type is `research` or `task`, call `subagent` with:
     - `name`: `wayfinder-worker #<ticket> <type>`
     - `agent`: `wayfinder-worker`
     - `interactive`: `false`
     - `fork`: `false`
     - `task`: `Run /skill:wayfinder for map #<map>, ticket #<ticket> (<type>). Work only this ticket. /skill:wayfinder owns resolution, closing the issue, and updating the map. As soon as /skill:wayfinder has posted the resolution comment and closed or otherwise dispositioned ticket #<ticket>, give a compact final summary and immediately call subagent_done; do not wait for more input. The dispatcher may continue after you finish because Wayfinder sessions can create more tickets.`

7. **Integrate completed workers.** When the harness delivers worker results, mark each ticket done or failed based on the result summary. Do not inspect logs or poll. Reload the map and child tickets after each completed batch because a worker, especially a grilling/prototype session, may have created, closed, blocked, unblocked, or relabelled tickets.

8. **Loop.** After reloading and classifying, publish the running summary. Spawn the next wave of newly takeable tickets. Continue until no open child ticket is takeable and no spawned worker is still running.

9. **Report the final snapshot.** Keep it compact:
   - Map number and title.
   - Counts: total child tickets, closed, open, done this run, failed, blocked, assigned, unknown.
   - Done ticket list: `#<ticket> <type> — <title>`.
   - Remaining open ticket list grouped by reason.

Completion criterion: every currently takeable known-type child ticket has been spawned exactly once, every harness-delivered worker result has been accounted for, the running summary is current, no worker logs were polled, and remaining open tickets are accounted for by blocked/assigned/unknown/failed/running status.
