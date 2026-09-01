---
name: to-pr-orchestrator
description: Orchestrate a completed Wayfinder map or SPEC issue through spec creation, ticket creation, implementation, final review, and PR creation.
disable-model-invocation: true
---

Orchestrate one GitHub issue to a pull request. The input is either a completed `wayfinder:map` issue or an existing SPEC/tracking issue.

The orchestrator owns workflow coordination only. It does not plan, implement, or review directly. It validates the source issue, spawns fresh-context agents for spec/ticket creation and the existing dispatchers, creates the integration branch, opens the pull request, comments on the SPEC, closes the SPEC, and reports compact phase summaries.

## Workflow rules

- Spawn every worker/dispatcher agent with fresh context: every `subagent` call sets `fork: false`.
- Never poll subagent logs. After spawning one phase, wait for the harness-delivered subagent result.
- Wayfinder work is out of scope. If a Wayfinder map still has open child issues, stop and report them; do not start `wayfinder-dispatcher`.
- `to-spec-agent` and `to-tickets-agent` are allowed to accept their own recommended seams, ticket breakdowns, and blocking edges without waiting for human confirmation.
- The implementation branch is `implement/issue-<spec>-<slug-from-spec-title>`.
- Run `implement-dispatcher` from the implementation branch.
- Run `code-review-dispatcher` from the implementation branch with explicit instruction not to close the SPEC.
- The review base defaults to `origin/main` unless the input explicitly provides a different fixed point.
- Create the PR only after implementation and final review succeed with a clean working tree.
- PR title: `Implement #<spec>: <SPEC title>`.
- PR body includes the SPEC link, implementation tickets, review result, and check summary when available.
- After the PR is created, post a SPEC comment linking the PR, then close the SPEC.
- Maintain compact phase summaries so the human can see where the workflow is without reading subagent logs.

## Steps

1. **Normalize input and fixed point.** Accept a bare number, `#<number>`, or GitHub issue URL. Extract the issue number and repository owner/name. If the URL names a repo, use it; otherwise use `gh repo view --json nameWithOwner`. Use an explicitly supplied fixed point or default to `origin/main`.

2. **Check local state.** Capture repository root, current branch, `git status --short`, and `git rev-parse <fixed-point>`. Stop if the working tree is dirty or the fixed point does not resolve.

3. **Load the source issue.** Run `gh issue view <issue> --repo <owner/repo> --json number,title,state,labels,body,url`. Stop if it is closed unless it is a closed Wayfinder map. Classify the source:
   - `wayfinder-map` if it has label `wayfinder:map`.
   - `spec` otherwise.

4. **If source is a Wayfinder map, gate on completion.** Find child issues using native sub-issues where available, otherwise fallback to issues whose body contains `Part of #<map>`. If any child is open, stop and report the open list. If all children are closed, publish:
   - `MAP #<map>: all <closed>/<total> child issues closed; creating SPEC.`

5. **Create the SPEC when needed.** If the source is a Wayfinder map, spawn:
   - `name`: `to-spec-agent #<map>`
   - `agent`: `to-spec-agent`
   - `interactive`: `false`
   - `fork`: `false`
   - `task`: `Run /skill:to-spec from completed Wayfinder map #<map> (<url>). Fetch the map, comments, and closed child ticket resolutions. This workflow pre-approves your recommended test seams, so do not wait for human confirmation. Publish the SPEC issue with ready-for-agent. End with TO_SPEC_OUTCOME.`

   When the result arrives, parse `TO_SPEC_OUTCOME`. Stop if `success` is not `yes` or no SPEC issue/url is reported. The created SPEC becomes the workflow SPEC.

   If the source is already a SPEC, the source issue is the workflow SPEC.

6. **Load the SPEC.** Run `gh issue view <spec> --repo <owner/repo> --json number,title,state,labels,body,url`. Stop if it is closed. Record the SPEC title and URL. Publish:
   - `SPEC #<spec>: <title> — ready for ticket creation.`

7. **Create implementation tickets.** Spawn:
   - `name`: `to-tickets-agent #<spec>`
   - `agent`: `to-tickets-agent`
   - `interactive`: `false`
   - `fork`: `false`
   - `task`: `Run /skill:to-tickets for SPEC #<spec> (<url>). This workflow pre-approves your proposed tracer-bullet breakdown and blocking edges, so do not wait for human confirmation. Publish implementation tickets as SPEC sub-issues, apply ready-for-agent unless intentionally blocked, and end with TO_TICKETS_OUTCOME.`

   When the result arrives, parse `TO_TICKETS_OUTCOME`. Stop if `success` is not `yes`, no tickets are reported, or `ready_for_implementation` is not `yes`. Record ticket numbers/titles/URLs for the final PR body.

8. **Create the implementation branch.** Slugify the SPEC title: lowercase, replace non-alphanumeric runs with `-`, trim leading/trailing `-`, and keep it short enough for a readable branch name. Create `implement/issue-<spec>-<slug>`. Stop if the branch already exists unless it points at the current `HEAD` and the working tree is clean. Check it out. Publish:
   - `BRANCH: implement/issue-<spec>-<slug> created from <fixed-point-or-current-head>.`

9. **Run implementation.** Spawn:
   - `name`: `implement-dispatcher #<spec>`
   - `agent`: `implement-dispatcher`
   - `interactive`: `false`
   - `fork`: `false`
   - `task`: `Run /skill:implement-dispatcher for SPEC #<spec> (<url>) from the current implementation branch. Implement all takeable ready-for-agent sub-issues, merge successful worker branches back into this branch, and end with the dispatcher's compact final snapshot. Do not run final code review and do not close SPEC #<spec>.`

   When the result arrives, reload the SPEC children. Stop if any implementation sub-issue remains open and report them grouped by reason if possible. Stop if `git status --short` is dirty.

10. **Run final review without SPEC closure.** Spawn:
    - `name`: `code-review-dispatcher #<spec>`
    - `agent`: `code-review-dispatcher`
    - `interactive`: `false`
    - `fork`: `false`
    - `task`: `Run /skill:code-review-dispatcher for SPEC #<spec> (<url>) against <fixed-point>. Review/fix until there are no relevant findings. Do not close SPEC #<spec>; leave final SPEC comment/closure to to-pr-orchestrator. End with the dispatcher's compact final snapshot.`

    When the result arrives, stop if the result reports a manual gate, failure, dirty working tree, unresolved findings, or missing clean final review. Stop if `git status --short` is dirty.

11. **Push the branch.** Run `git push -u origin <branch>`. Stop on failure.

12. **Create the PR.** Build a temp-file PR body with:
    - `## Spec` linking the SPEC.
    - `## Implementation tickets` listing created/closed tickets.
    - `## Review` stating the final code review against the fixed point has no relevant findings.
    - `## Checks` with any check summary available from worker/dispatcher results, or `See implementation and review dispatcher summaries.`

    Run `gh pr create --repo <owner/repo> --base main --head <branch> --title "Implement #<spec>: <SPEC title>" --body-file <temp-file>`. If the repo's default branch is not `main`, use `gh repo view --json defaultBranchRef` and target that branch. Record the PR URL.

13. **Comment on and close the SPEC.** Post a comment on the SPEC with the PR URL, branch, HEAD SHA, fixed point, ticket count, and statement that final review has no relevant findings. Then close the SPEC. Stop with the PR URL if comment or close fails.

14. **Report final snapshot.** Keep it compact:
    - Source issue and type.
    - SPEC number/title/url.
    - Branch and HEAD SHA.
    - Ticket count and ticket list.
    - Review base and clean review status.
    - PR URL.
    - SPEC close status.

Completion criterion: the source issue was classified, a completed Wayfinder map produced a SPEC when needed, implementation tickets were created and closed, worker branches were integrated into the implementation branch, final review has no relevant findings, the branch is pushed, a PR exists, the SPEC has a PR comment and is closed, the working tree is clean, every subagent result has been accounted for, and the final snapshot is current.
