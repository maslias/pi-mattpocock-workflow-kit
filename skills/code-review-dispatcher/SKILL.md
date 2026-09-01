---
name: code-review-dispatcher
description: Run an automated final code-review/fix loop for a SPEC issue, then close the SPEC when clean unless an outer workflow owns closure.
disable-model-invocation: true
---

Dispatch one GitHub SPEC issue through a final `/skill:code-review` loop. The input is a GitHub issue number or URL for a SPEC/tracking issue, plus an optional fixed point and optional `do not close SPEC` mode. Default fixed point is `origin/main`. The human starts on the implementation branch before invoking the dispatcher.

The orchestrator owns workflow coordination only: verify all SPEC sub-issues are closed, spawn a review worker, route relevant findings to a fix worker through a local handoff, repeat until the review is clean, then either close the SPEC issue or leave closure to an outer workflow when explicitly instructed. Review workers own review and handoff creation. Fix workers own TDD, code changes, checks, and commit-if-green.

## Dispatch rules

- Spawn workers with fresh context: every `subagent` call sets `fork: false`.
- Session names include agent name, SPEC, and iteration:
  - `code-review-worker #<spec> iter-<n>`
  - `code-review-fix-worker #<spec> iter-<n>`
  - Dispatcher agent, when spawned elsewhere: `code-review-dispatcher #<spec>`
- Default review base is `origin/main`; use a different fixed point only when the dispatcher input explicitly provides one.
- Stop before review if any SPEC child issue is still open.
- Stop before spawning if the working tree is dirty.
- Review prompt shape:

  ```text
  /skill:code-review

  Review HEAD against <fixed-point>.
  Spec: #<spec>
  ```

- Review workers must end with `REVIEW_WORKER_OUTCOME` containing `relevant_findings`, `manual_gate_required`, `handoff_path`, and a mini findings list.
- Automatically fix relevant findings unless `manual_gate_required: yes`.
- Manual gate is required for ambiguity, conflicting parent/child requirements, uncertain scope removal, product/design decisions, or security/data-loss risk in the proposed fix.
- Findings handoffs live under `.agent-tmp/code-review-dispatcher/spec-<spec>/handoffs/pending/iteration-<n>.md` while active.
- After a successful fix, move that handoff to `.agent-tmp/code-review-dispatcher/spec-<spec>/handoffs/resolved/iteration-<n>.md`.
- If a fix worker fails, leaves the working tree dirty, or does not commit after code changes, stop with the failure summary and pending handoff path.
- Never poll subagent logs. After spawning a worker, wait for the harness-delivered subagent result.
- Maintain a compact running summary after every review and fix so the human can see progress without reading worker logs.
- After a clean final review, post a resolution comment and close the parent SPEC issue unless the input explicitly says `do not close SPEC`, `leave SPEC open`, or `outer workflow owns SPEC closure`.
- In `do not close SPEC` mode, report the clean review and leave SPEC comment/closure to the caller. Keep local handoff artifacts available for the caller unless they are empty and no longer needed.

## Steps

1. **Normalize the SPEC id, fixed point, and closure mode.** Accept a bare number, `#<number>`, or GitHub issue URL. Extract the issue number and repository owner/name. If the URL names a repo, use it; otherwise use the current `gh repo view --json nameWithOwner` repo. Use the provided fixed point or default to `origin/main`. If the input explicitly says `do not close SPEC`, `leave SPEC open`, or `outer workflow owns SPEC closure`, set closure mode to `leave-open`; otherwise set it to `close-spec`.

2. **Check branch state.** Capture `git branch --show-current`, repository root, `git rev-parse HEAD`, and `git status --short`. Stop if the working tree is dirty. Confirm the fixed point resolves with `git rev-parse <fixed-point>`. If `.agent-tmp/` is not ignored by git, warn the human in the running summary; do not edit `.gitignore` automatically.

3. **Load the SPEC.** Run `gh issue view <spec> --repo <owner/repo> --json number,title,state,labels,body,url`. Stop if the SPEC is closed or cannot be read.

4. **Find sub-issues.** Prefer GitHub native sub-issues if available. If the repo/API does not expose sub-issues, use fallback conventions:
   - child body contains `Parent` followed by `#<spec>`;
   - child body contains `Part of #<spec>`;
   - issue search for `<spec> in:body` and verify the parent marker.

   For each child, collect number, title, url, state, labels, assignees, and body. Include both open and closed children when counting.

5. **Gate on sub-issue closure.** If any child issue is open, stop and report the open child list. This dispatcher is a final review/closure loop; open implementation tickets belong to `/skill:implement-dispatcher` first.

6. **Recover local handoff state.** Inspect `.agent-tmp/code-review-dispatcher/spec-<spec>/handoffs/pending/` and `.agent-tmp/code-review-dispatcher/spec-<spec>/handoffs/resolved/` if present. Report existing pending/resolved counts. Do not assume a pending handoff still needs fixing; the next review is the source of truth. If the working tree is clean, continue with a new review. Choose the next iteration as one higher than the highest existing `iteration-<n>.md` in pending or resolved, or `1` if none exist.

7. **Spawn one review worker.** Call `subagent` with:
   - `name`: `code-review-worker #<spec> iter-<n>`
   - `agent`: `code-review-worker`
   - `interactive`: `false`
   - `fork`: `false`
   - `task`: `Run /skill:code-review for SPEC #<spec> against <fixed-point>. Use this prompt: "Review HEAD against <fixed-point>. Spec: #<spec>". If there are relevant findings, run /skill:handoff to create a fresh-session handoff for fixing these code-review findings. Ensure the handoff is stored at .agent-tmp/code-review-dispatcher/spec-<spec>/handoffs/pending/iteration-<n>.md. End with REVIEW_WORKER_OUTCOME including relevant_findings, manual_gate_required, handoff_path, and mini findings. Do not modify code or commit.`

8. **Handle review result.** When the harness delivers the review worker result:
   - Record a mini summary for each finding: id, axis, severity, summary, needs_human.
   - If the result is missing or cannot be interpreted, stop with the raw summary.
   - If `manual_gate_required: yes`, stop and show the findings requiring human decision plus the handoff path if one exists.
   - If `relevant_findings: no`, go to final clean-review handling.
   - If `relevant_findings: yes`, require a handoff path under `.agent-tmp/code-review-dispatcher/spec-<spec>/handoffs/pending/iteration-<n>.md`; stop if missing.

9. **Spawn one fix worker.** Call `subagent` with:
   - `name`: `code-review-fix-worker #<spec> iter-<n>`
   - `agent`: `code-review-fix-worker`
   - `interactive`: `false`
   - `fork`: `false`
   - `task`: `Run /skill:tdd to fix the review findings from handoff .agent-tmp/code-review-dispatcher/spec-<spec>/handoffs/pending/iteration-<n>.md for SPEC #<spec>. Base: <fixed-point>. Only fix those findings. Add/update tests if needed. Run relevant checks. Commit if all checks pass. End with FIX_WORKER_OUTCOME including success, committed, commit, checks, and reason.`

10. **Handle fix result.** When the harness delivers the fix worker result:
    - Inspect `git status --short`. If dirty, stop and report the dirty state and pending handoff path.
    - If the worker reports failure, stop and report the failure and pending handoff path.
    - If code changed but no commit exists, stop and report the mismatch.
    - Move `.agent-tmp/code-review-dispatcher/spec-<spec>/handoffs/pending/iteration-<n>.md` to `.agent-tmp/code-review-dispatcher/spec-<spec>/handoffs/resolved/iteration-<n>.md`.
    - Record the fix commit and check summary.

11. **Publish a running summary.** After every review and fix, report one compact line plus changed findings only:
    - `SPEC #<spec>: iteration <n>, base <fixed-point>, findings <count>, manual gate <yes|no>, fixes <count>, pending handoffs <count>, resolved handoffs <count>.`
    - New findings: `<id> <axis> <severity> — <summary>`.
    - New fix commit: `<sha> — <checks summary>`.
    - Failures only when present.

12. **Loop.** Increment the iteration and spawn another review worker. Continue until a review reports no relevant findings, a manual gate is required, or a fix fails. A clean working tree is required before every spawn.

13. **Handle clean final review.** On clean final review, reload the SPEC to ensure it is still open. Prepare a resolution summary with:
    - fixed point;
    - final branch and HEAD SHA;
    - child issue count and confirmation that all children are closed;
    - review iteration count;
    - fix commits and check summaries;
    - accepted/irrelevant findings if any;
    - statement: `Final code review has no relevant findings.`

    If closure mode is `close-spec`, post the summary as a SPEC resolution comment and close the SPEC with `gh issue close <spec> --repo <owner/repo> --comment <comment-or-use-temp-file>`.

    If closure mode is `leave-open`, do not comment on or close the SPEC. Report the prepared summary in the final snapshot so the outer workflow can use it.

14. **Clean local handoffs.** In `close-spec` mode, only after the SPEC close command succeeds, delete `.agent-tmp/code-review-dispatcher/spec-<spec>/`. In `leave-open` mode, delete only empty handoff directories; leave non-empty handoff artifacts for the caller. Leave other SPEC directories untouched. If `.agent-tmp/code-review-dispatcher/` and `.agent-tmp/` become empty, remove those empty directories too.

15. **Report the final snapshot.** Keep it compact:
    - SPEC number and title;
    - fixed point;
    - final branch and HEAD SHA;
    - review iterations;
    - fix commits;
    - closure mode and SPEC close status;
    - handoff cleanup status;
    - `.agent-tmp/` ignore warning if it is still not ignored.

Completion criterion: every SPEC child issue is closed, the final review against the fixed point reports no relevant findings, every fix worker result has been accounted for, successful fixes are committed with a clean working tree, closure mode was followed, local handoffs for that SPEC were cleaned up according to closure mode, empty workflow temp directories are cleaned up when safe, no worker logs were polled, and the final snapshot is current.
