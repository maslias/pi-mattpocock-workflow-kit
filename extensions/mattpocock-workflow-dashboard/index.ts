import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

type RunKind = "2pr" | "wayfinder" | "implement" | "code-review" | "unknown";
type RunStatus = "running" | "completed" | "blocked" | "failed" | "unknown";

interface WorkflowRun {
	id: string;
	kind: RunKind;
	scope: string;
	status: RunStatus;
	phase?: string;
	summary: string;
	counts: Record<string, number | string>;
	events: string[];
	updatedAt: string;
}

interface DashboardState {
	version: 1;
	updatedAt: string;
	runs: WorkflowRun[];
	warnings: string[];
}

const EXTENSION_ID = "mattpocock-workflow-dashboard";
const MAX_EVENTS = 5;
const REQUIRED_AGENTS = [
	"code-review-dispatcher",
	"code-review-fix-worker",
	"code-review-worker",
	"implement-dispatcher",
	"implement-worker",
	"to-pr-orchestrator",
	"to-spec-agent",
	"to-tickets-agent",
	"wayfinder-dispatcher",
	"wayfinder-worker",
	"wayfinder-worker-interactive",
];

const INITIAL_STATE: DashboardState = {
	version: 1,
	updatedAt: new Date(0).toISOString(),
	runs: [],
	warnings: [],
};

let state: DashboardState = structuredClone(INITIAL_STATE);

function now(): string {
	return new Date().toISOString();
}

function statusFile(ctx: ExtensionContext): string {
	return path.join(ctx.cwd, CONFIG_DIR_NAME, "mattpocock-workflow", "status.json");
}

async function loadState(ctx: ExtensionContext): Promise<void> {
	try {
		const raw = await fs.promises.readFile(statusFile(ctx), "utf8");
		const parsed = JSON.parse(raw) as DashboardState;
		if (parsed.version === 1 && Array.isArray(parsed.runs)) state = parsed;
	} catch {
		state = structuredClone(INITIAL_STATE);
	}
}

async function persistState(ctx: ExtensionContext): Promise<void> {
	state.updatedAt = now();
	const file = statusFile(ctx);
	await fs.promises.mkdir(path.dirname(file), { recursive: true });
	await fs.promises.writeFile(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function findRun(id: string, kind: RunKind, scope: string): WorkflowRun {
	let run = state.runs.find((r) => r.id === id);
	if (!run) {
		run = { id, kind, scope, status: "running", summary: "Starting", counts: {}, events: [], updatedAt: now() };
		state.runs.unshift(run);
	}
	return run;
}

function addEvent(run: WorkflowRun, event: string): void {
	run.events.unshift(event);
	run.events = run.events.slice(0, MAX_EVENTS);
	run.updatedAt = now();
}

function parseCountLine(line: string): { id: string; kind: RunKind; scope: string; summary: string; counts: Record<string, number | string> } | null {
	let match = line.match(/^MAP #(\d+): (\d+)\/(\d+) closed, (\d+) open, (\d+) done this run, (\d+) running, (\d+) takeable, (\d+) blocked, (\d+) assigned, (\d+) unknown, (\d+) failed\.?$/);
	if (match) {
		const [, map, closed, total, open, done, running, takeable, blocked, assigned, unknown, failed] = match;
		return {
			id: `map-${map}`,
			kind: "wayfinder",
			scope: `MAP #${map}`,
			summary: line,
			counts: { closed: +closed, total: +total, open: +open, done: +done, running: +running, takeable: +takeable, blocked: +blocked, assigned: +assigned, unknown: +unknown, failed: +failed },
		};
	}

	match = line.match(/^SPEC #(\d+): (\d+)\/(\d+) closed, (\d+) open, (\d+) merged this run, (\d+) running, (\d+) takeable, (\d+) blocked, (\d+) assigned, (\d+) not-ready, (\d+) failed\.?$/);
	if (match) {
		const [, spec, closed, total, open, merged, running, takeable, blocked, assigned, notReady, failed] = match;
		return {
			id: `implement-${spec}`,
			kind: "implement",
			scope: `SPEC #${spec}`,
			summary: line,
			counts: { closed: +closed, total: +total, open: +open, merged: +merged, running: +running, takeable: +takeable, blocked: +blocked, assigned: +assigned, "not-ready": +notReady, failed: +failed },
		};
	}

	match = line.match(/^SPEC #(\d+): iteration (\d+), base ([^,]+), findings (\d+), manual gate (yes|no), fixes (\d+), pending handoffs (\d+), resolved handoffs (\d+)\.?$/);
	if (match) {
		const [, spec, iteration, base, findings, manualGate, fixes, pending, resolved] = match;
		return {
			id: `review-${spec}`,
			kind: "code-review",
			scope: `SPEC #${spec}`,
			summary: line,
			counts: { iteration: +iteration, base, findings: +findings, manualGate, fixes: +fixes, pendingHandoffs: +pending, resolvedHandoffs: +resolved },
		};
	}

	return null;
}

function parsePhaseLine(line: string): { id: string; phase: string; scope: string; summary: string } | null {
	let match = line.match(/^MAP #(\d+): all (\d+)\/(\d+) child issues closed; creating SPEC\.?$/);
	if (match) return { id: `2pr-map-${match[1]}`, phase: "spec", scope: `MAP #${match[1]}`, summary: line };

	match = line.match(/^SPEC #(\d+): (.+) — ready for ticket creation\.?$/);
	if (match) return { id: `2pr-spec-${match[1]}`, phase: "tickets", scope: `SPEC #${match[1]}`, summary: line };

	match = line.match(/^BRANCH: (.+) created from (.+)\.?$/);
	if (match) return { id: `2pr-branch-${match[1]}`, phase: "branch", scope: match[1], summary: line };

	return null;
}

function ingestText(text: string): boolean {
	let changed = false;
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;

		const count = parseCountLine(line);
		if (count) {
			const run = findRun(count.id, count.kind, count.scope);
			run.summary = count.summary;
			run.counts = count.counts;
			run.status = Number(count.counts.failed ?? 0) > 0 ? "failed" : Number(count.counts.running ?? 0) > 0 ? "running" : "unknown";
			addEvent(run, line);
			changed = true;
			continue;
		}

		const phase = parsePhaseLine(line);
		if (phase) {
			const run = findRun(phase.id, "2pr", phase.scope);
			run.phase = phase.phase;
			run.summary = phase.summary;
			run.status = "running";
			addEvent(run, line);
			changed = true;
			continue;
		}

		if (/^PR URL:|https:\/\/github\.com\/.*\/pull\/\d+/.test(line)) {
			const run = findRun("2pr-pr", "2pr", "PR");
			run.phase = "pr";
			run.status = "completed";
			run.summary = line;
			addEvent(run, line);
			changed = true;
		}
	}
	return changed;
}

function collectTextFromMessage(message: any): string {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

function collectTextFromToolResult(event: any): string {
	const chunks: string[] = [];
	for (const part of event?.content ?? []) {
		if (part?.type === "text" && typeof part.text === "string") chunks.push(part.text);
	}
	for (const result of event?.details?.results ?? []) {
		for (const message of result.messages ?? []) chunks.push(collectTextFromMessage(message));
	}
	return chunks.join("\n");
}

function missingAgentNames(ctx: ExtensionContext): string[] {
	const localDir = path.join(ctx.cwd, CONFIG_DIR_NAME, "agents");
	const globalDir = path.join(process.env.HOME ?? "", ".pi", "agent", "agents");
	return REQUIRED_AGENTS.filter((name) => !fs.existsSync(path.join(localDir, `${name}.md`)) && !fs.existsSync(path.join(globalDir, `${name}.md`)));
}

function updateWarnings(ctx: ExtensionContext): void {
	const warnings: string[] = [];
	const missingAgents = missingAgentNames(ctx);
	if (missingAgents.length > 0) warnings.push(`Missing agents: ${missingAgents.join(", ")}. See package README.`);
	warnings.push("External prerequisites: Matt Pocock skills, maplezzk/pi-interactive-subagents, GitHub CLI auth, and a supported mux/terminal.");
	state.warnings = warnings;
}

function configuredPlacement(ctx: ExtensionContext): "belowEditor" | undefined {
	try {
		const configPath = path.join(ctx.cwd, CONFIG_DIR_NAME, "mattpocock-workflow", "config.json");
		const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as { placement?: string };
		return config.placement === "belowEditor" ? "belowEditor" : undefined;
	} catch {
		return undefined;
	}
}

function renderDashboard(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	const placement = configuredPlacement(ctx);
	ctx.ui.setWidget(EXTENSION_ID, (_tui, theme) => ({
		invalidate() {},
		render(width: number): string[] {
			const lines: string[] = [];
			lines.push(theme.fg("accent", "Matt Pocock Workflow"));
			if (state.runs.length === 0) {
				lines.push(theme.fg("dim", "No workflow status detected yet."));
			} else {
				for (const run of state.runs.slice(0, 4)) {
					const icon = run.status === "failed" ? theme.fg("error", "✗") : run.status === "completed" ? theme.fg("success", "✓") : theme.fg("accent", "●");
					const phase = run.phase ? ` — ${run.phase}` : "";
					lines.push(`${icon} ${run.scope}${phase}: ${run.summary}`);
					for (const event of run.events.slice(0, MAX_EVENTS)) lines.push(theme.fg("dim", `  · ${event}`));
				}
			}
			for (const warning of state.warnings.slice(0, 2)) lines.push(theme.fg("warning", `! ${warning}`));
			return lines.map((line) => truncateToWidth(line, width));
		},
	}), placement ? { placement } : undefined);

	const active = state.runs[0];
	const status = active ? `2PR: ${active.phase ?? active.kind} — ${active.scope}` : "Workflow dashboard ready";
	ctx.ui.setStatus(EXTENSION_ID, ctx.ui.theme.fg("accent", status));
}

export default function mattpocockWorkflowDashboard(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		await loadState(ctx);
		updateWarnings(ctx);
		renderDashboard(ctx);
		await persistState(ctx);
	});

	pi.on("message_end", async (event, ctx) => {
		const text = collectTextFromMessage((event as any).message);
		if (!text || !ingestText(text)) return;
		updateWarnings(ctx);
		renderDashboard(ctx);
		await persistState(ctx);
	});

	pi.on("tool_result", async (event, ctx) => {
		const text = collectTextFromToolResult(event);
		if (!text || !ingestText(text)) return;
		updateWarnings(ctx);
		renderDashboard(ctx);
		await persistState(ctx);
	});

	pi.registerCommand("workflow-dashboard", {
		description: "Show Matt Pocock workflow dashboard status file path and current detected runs.",
		handler: async (_args, ctx) => {
			updateWarnings(ctx);
			renderDashboard(ctx);
			await persistState(ctx);
			ctx.ui.notify(`Workflow dashboard: ${state.runs.length} run(s). Status file: ${statusFile(ctx)}`, "info");
		},
	});
}
