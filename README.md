# pi-mattpocock-workflow-kit

A Pi package for a Matt Pocock-style SPEC-to-PR workflow.

It bundles:

- a Pi TUI workflow dashboard extension
- the local dispatcher/orchestrator/worker agents from `agents/`
- the local dispatcher/orchestrator skills from `skills/`

The dashboard does **not** start workflows. It watches live dispatcher/orchestrator output in the current Pi session and shows a compact fixed status area only after workflow output is detected.

## What the dashboard shows

- active `to-pr-orchestrator` / dispatcher progress
- the current workflow role, e.g. `wayfinder dispatcher`, `to-spec`, `to-tickets`, `implementation dispatcher`, or `code-review dispatcher`
- SPEC, ticket, branch, implementation, review, and PR phases
- a compact one-line row per active run: issue title on the left, count chips on the right
- compact dispatcher counts such as takeable, running, open, closed, blocked, assigned, and failed
- an extra warning line when a relevant dispatcher/orchestrator message says the workflow is blocked, failed, waiting for a human decision, or cannot continue
- multiple runs if more than one is detected

Dashboard text is English.

Status is persisted in the current project at:

```text
.pi/mattpocock-workflow/status.json
```

Persisted status is for diagnostics/history only. It does not make the dashboard appear on Pi startup; the widget activates only after live dispatcher/orchestrator output is detected in the current session.

## Install

From a published GitHub repo:

```bash
pi install https://github.com/maslias/pi-mattpocock-workflow-kit
```

For project-local installation, use:

```bash
pi install -l https://github.com/maslias/pi-mattpocock-workflow-kit
```

For local development from this checkout:

```bash
pi install ./pi-mattpocock-workflow-kit
```

The Pi package manifest loads the extension and skills. Pi package manifests do not currently provide a first-class agents resource type, so install the bundled agents separately.

## Install bundled agents

Choose one scope.

### Project-local agents

Use this when you want the workflow agents only in the current project:

```bash
mkdir -p .pi/agents
cp -R ./pi-mattpocock-workflow-kit/agents/*.md .pi/agents/
```

### Global agents

Use this when you want the workflow agents available in all Pi projects:

```bash
mkdir -p ~/.pi/agent/agents
cp -R ./pi-mattpocock-workflow-kit/agents/*.md ~/.pi/agent/agents/
```

The extension warns when required bundled agents are not found in either `.pi/agents` or `~/.pi/agent/agents`.

## External prerequisites

This package does not automatically install third-party workflow dependencies. Install/configure them yourself:

- Modified interactive subagents extension: https://github.com/maplezzk/pi-extensions
- Matt Pocock skills: https://github.com/mattpocock/skills
- GitHub CLI: https://cli.github.com/
- Git, with a clean working tree before dispatcher/orchestrator runs
- A GitHub repository using Issues/sub-issues or the fallback parent markers used by the bundled skills

The workflow depends on these external Matt Pocock skills being available in Pi:

- `wayfinder`
- `to-spec`
- `to-tickets`
- `implement`
- `code-review`
- `handoff`
- `tdd`
- `resolving-merge-conflicts`

The interactive subagents extension needs a terminal multiplexer or a supported terminal/workbench. Supported options include:

- cmux
- tmux
- zellij
- WezTerm
- herdr
- Otty
- Orca

Start Pi inside one of those environments, for example:

```bash
tmux new -A -s pi 'pi'
# or start herdr, open/split a pane, then run: pi
```

If needed, force the subagent backend with:

```bash
export PI_SUBAGENT_MUX=tmux
# or: cmux, zellij, wezterm, herdr, otty, orca
```

For Herdr, the interactive subagents package also supports:

```bash
export PI_SUBAGENT_HERDR_MODE=tab
# or: split
```

If you use the modified interactive subagents behavior from this setup, do **not** globally disable or delay subagent nudges. Autonomous workers need the default quick nudge so forgotten `subagent_done` calls are caught; long-running human-in-the-loop workers should instead be marked interactive (`interactive: true` in the agent frontmatter or subagent call).

Keep only locale/config exports such as:

```bash
# pi-env
export PI_EXTENSIONS_LOCALE=en-US
# /pi-env
```

After changing your shell config, open a new shell or run `source ~/.zshrc` / `source ~/.bashrc` before starting Pi.

Make sure `gh` is installed and authenticated before running the workflow agents:

```bash
gh auth status
```

The dashboard extension may warn about these prerequisites, but it does not install them.

## Usage

This package provides two layers:

1. **Skills** describe the workflow instructions.
2. **Agents** run those skills in fresh subagent sessions with the right role, tools, and naming conventions.

In normal use, prefer the agents. They give the workflow a fresh context and let the interactive subagents extension manage panes, progress, and completion messages.

### Wayfinder dispatcher

Use `wayfinder-dispatcher` when you have a Wayfinder map issue with child Wayfinder tickets.

It:

- classifies Wayfinder child tickets
- spawns AFK workers for research/task tickets
- spawns interactive workers for prototype/grilling tickets
- reloads the map after workers finish because they may create more tickets
- stops when no takeable ticket remains and no worker is running

Example prompt:

```text
Run wayfinder-dispatcher for map #123.
```

### Implementation dispatcher

Use `implement-dispatcher` when you already have a SPEC issue with implementation tickets and you want the ready tickets implemented.

It does not implement code itself. It:

- finds takeable SPEC child tickets
- creates isolated git worktrees and branches
- spawns `implement-worker` agents
- merges successful worker branches back into the current implementation branch
- reports open/closed/running/blocked/failed counts

It does **not** run final code review and does **not** close the SPEC.

Example prompt:

```text
Run implement-dispatcher for SPEC #123.
```

### Code-review dispatcher

Use `code-review-dispatcher` after implementation tickets are closed and you want a final review/fix loop.

It:

- verifies all SPEC child issues are closed
- spawns `code-review-worker` for one review iteration
- sends relevant findings to `code-review-fix-worker`
- repeats until the final review is clean
- either closes the SPEC or leaves closure to the outer orchestrator, depending on the prompt

Example prompt:

```text
Run code-review-dispatcher for SPEC #123 against origin/main.
```

When used inside `to-pr-orchestrator`, it is instructed not to close the SPEC because the orchestrator owns final PR/SPEC closure.

### Full SPEC-to-PR orchestration

Use `to-pr-orchestrator` when you already have one of these inputs:

- a completed Wayfinder map issue, or
- an existing SPEC issue.

The orchestrator does not start from a blank idea. It needs an existing Wayfinder map or SPEC to coordinate.

It coordinates the whole workflow:

1. validate the input issue
2. create a SPEC from a completed Wayfinder map, if needed
3. create implementation tickets
4. create the implementation branch
5. run the implementation dispatcher
6. run the final code-review dispatcher
7. push the branch
8. open the PR
9. comment on and close the SPEC

Example prompt:

```text
Run to-pr-orchestrator for #123.
```

Or, if you are calling the subagent tool directly:

```text
Spawn agent `to-pr-orchestrator` for issue #123.
```

### Worker agents

Worker agents are normally spawned by dispatchers, not by humans directly:

- `implement-worker` implements one SPEC sub-issue in one worktree.
- `code-review-worker` performs one review pass and creates a handoff if fixes are needed.
- `code-review-fix-worker` fixes one review handoff and commits when checks pass.
- `wayfinder-worker` handles one AFK Wayfinder ticket.
- `wayfinder-worker-interactive` handles one human-in-the-loop Wayfinder ticket.
- `to-spec-agent` creates a SPEC from a completed Wayfinder map.
- `to-tickets-agent` creates implementation tickets from one SPEC.

## Configure dashboard

Default placement is above the editor.

To render below the editor, create:

```json
// .pi/mattpocock-workflow/config.json
{
  "placement": "belowEditor"
}
```

Remove the file or use any other value to return to the default above-editor placement.

You can disable or re-enable the dashboard from inside Pi:

```text
/workflow-dashboard off
/workflow-dashboard on
/workflow-dashboard toggle
/workflow-dashboard status
```

This persists to `.pi/mattpocock-workflow/config.json` as `"enabled": false` when disabled. While disabled, the extension clears the widget/status and stops ingesting workflow output.

## Included agents

- `to-pr-orchestrator`
- `implement-dispatcher`
- `code-review-dispatcher`
- `wayfinder-dispatcher`
- `implement-worker`
- `code-review-worker`
- `code-review-fix-worker`
- `wayfinder-worker`
- `wayfinder-worker-interactive`
- `to-spec-agent`
- `to-tickets-agent`

## Included skills

- `to-pr-orchestrator`
- `implement-dispatcher`
- `code-review-dispatcher`
- `wayfinder-dispatcher`

## Development notes

The MVP parses compact summary lines that the existing agents/skills already emit. Future versions should move to explicit structured workflow status events/data written by dispatchers and the orchestrator.
