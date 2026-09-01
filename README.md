# pi-mattpocock-workflow-kit

A Pi package for a Matt Pocock-style SPEC-to-PR workflow.

It bundles:

- a Pi TUI workflow dashboard extension
- the local dispatcher/orchestrator/worker agents from `agents/`
- the local dispatcher/orchestrator skills from `skills/`

The dashboard does **not** start workflows. It watches existing dispatcher/orchestrator output and shows a compact fixed status area.

## What the dashboard shows

- active `to-pr-orchestrator` / dispatcher progress
- SPEC, ticket, branch, implementation, review, and PR phases
- dispatcher counts such as open, closed, running, failed, blocked, assigned, and not-ready
- the last 5 detected workflow events
- multiple runs if more than one is detected

Dashboard text is English.

Status is persisted in the current project at:

```text
.pi/mattpocock-workflow/status.json
```

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

Make sure `gh` is installed and authenticated before running the workflow agents:

```bash
gh auth status
```

The dashboard extension may warn about these prerequisites, but it does not install them.

## Configure dashboard placement

Default placement is above the editor.

To render below the editor, create:

```json
// .pi/mattpocock-workflow/config.json
{
  "placement": "belowEditor"
}
```

Remove the file or use any other value to return to the default above-editor placement.

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
