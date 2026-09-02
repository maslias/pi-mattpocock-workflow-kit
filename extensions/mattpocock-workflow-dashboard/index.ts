import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type RunKind = "2pr" | "wayfinder" | "implement" | "code-review" | "unknown";
type RunStatus = "running" | "completed" | "blocked" | "failed" | "unknown";

interface WorkflowRun {
	id: string;
	kind: RunKind;
	scope: string;
	status: RunStatus;
	phase?: string;
	title?: string;
	alert?: string;
	startedAt?: string;
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

interface DashboardConfig {
	placement?: string;
	enabled?: boolean;
}

const EXTENSION_ID = "mattpocock-workflow-dashboard";
const INFO_TEXT_FG = "\x1b[38;2;255;255;255m";
const RESET_FG = "\x1b[39m";
const MAX_EVENTS = 3;
const WORKFLOW_ENTRYPOINT_NAMES = new Set(["wayfinder-dispatcher", "implement-dispatcher", "code-review-dispatcher", "to-pr-orchestrator"]);
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
let visibleThisSession = false;
let workflowActiveThisSession = false;
let activeRunIdsThisSession = new Set<string>();
let dashboardTimer: ReturnType<typeof setInterval> | undefined;
let dashboardWidgetMounted = false;
let dashboardWidgetPlacement: "aboveEditor" | "belowEditor" | undefined;
let requestDashboardRender: (() => void) | undefined;

function now(): string {
	return new Date().toISOString();
}

function workflowDir(ctx: ExtensionContext): string {
	return path.join(ctx.cwd, CONFIG_DIR_NAME, "mattpocock-workflow");
}

function statusFile(ctx: ExtensionContext): string {
	return path.join(workflowDir(ctx), "status.json");
}

function configFile(ctx: ExtensionContext): string {
	return path.join(workflowDir(ctx), "config.json");
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
		run = { id, kind, scope, status: "running", startedAt: now(), summary: "Starting", counts: {}, events: [], updatedAt: now() };
		state.runs.unshift(run);
	}
	if (!activeRunIdsThisSession.has(id)) {
		run.startedAt = now();
		activeRunIdsThisSession.add(id);
	}
	return run;
}

function addEvent(run: WorkflowRun, event: string): void {
	run.events = [event, ...run.events.filter((existing) => existing !== event)].slice(0, MAX_EVENTS);
	run.updatedAt = now();
}

function markDashboardVisible(): void {
	visibleThisSession = true;
}

function hasWorkflowEntrypointName(value: unknown): boolean {
	if (typeof value !== "string") return false;
	return WORKFLOW_ENTRYPOINT_NAMES.has(value) || [...WORKFLOW_ENTRYPOINT_NAMES].some((name) => value.includes(name));
}

function workflowSkillIsActive(event: any): boolean {
	const prompt = typeof event?.prompt === "string" ? event.prompt : "";
	if (!prompt) return false;
	return [...WORKFLOW_ENTRYPOINT_NAMES].some((name) => prompt.includes(`/skill:${name}`) || prompt.includes(`<skill name="${name}"`) || prompt.includes(`<skill name='${name}'`));
}

function workflowAgentIsStarting(event: any): boolean {
	if (event?.toolName !== "subagent") return false;
	return hasWorkflowEntrypointName(event?.input?.agent) || hasWorkflowEntrypointName(event?.input?.name);
}

function deactivateWorkflowDashboard(ctx: ExtensionContext): void {
	workflowActiveThisSession = false;
	visibleThisSession = false;
	clearDashboard(ctx);
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

function parsePhaseLine(line: string): { id: string; phase: string; scope: string; summary: string; title?: string } | null {
	let match = line.match(/^MAP #(\d+): all (\d+)\/(\d+) child issues closed; creating SPEC\.?$/);
	if (match) return { id: `2pr-map-${match[1]}`, phase: "spec", scope: `MAP #${match[1]}`, summary: line, title: state.runs.find((run) => run.scope === `MAP #${match[1]}`)?.title };

	match = line.match(/^SPEC #(\d+): (.+) — ready for ticket creation\.?$/);
	if (match) return { id: `2pr-spec-${match[1]}`, phase: "tickets", scope: `SPEC #${match[1]}`, summary: line, title: match[2] };

	match = line.match(/^BRANCH: (.+) created from (.+)\.?$/);
	if (match) return { id: `2pr-branch-${match[1]}`, phase: "branch", scope: match[1], summary: line };

	return null;
}

function parseTitleLine(line: string): { issue: string; title: string } | null {
	const match = line.match(/^Final snapshot — #(\d+) [“"](.+)[”"]$/);
	if (!match) return null;
	return { issue: match[1], title: match[2] };
}

function isStructuredDataLine(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.startsWith("[{") || trimmed.startsWith("[") || trimmed.startsWith("{") || trimmed.startsWith("}") || trimmed.startsWith("]") || /^"[^"]+"\s*:/.test(trimmed) || /^-\s*[{[]/.test(trimmed);
}

function parseAlertLine(line: string): string | null {
	if (isStructuredDataLine(line)) return null;
	if (/^No takeable child tickets remain/i.test(line)) return line;
	if (/manual gate/i.test(line)) return line;
	if (/\b(blocked|blocking|failed|failure|error|cannot|can't|unable|stopped|dirty working tree)\b/i.test(line)) return line;
	if (/human|interactive|decision required|needs decision|waiting for user/i.test(line)) return line;
	return null;
}

function normalizeWorkflowEventLine(label: string, ticket: string, rest: string): string {
	const prefixes: Record<string, string> = {
		"Newly discovered": "discovered",
		"Newly unblocked/takeable": "takeable",
		"Newly spawned": "spawned",
		"Newly done": "done",
		"New failure": "failed",
	};
	const prefix = prefixes[label] ?? label.toLowerCase();
	return `${prefix}: #${ticket} ${rest}`;
}

function parseWorkflowEventLine(line: string, currentListLabel?: string): { id: string; event: string } | null {
	let match = line.match(/^(Newly discovered|Newly unblocked\/takeable|Newly spawned|Newly done|New failure): #(\d+)\s+(.+)$/);
	if (match) return { id: "latest", event: normalizeWorkflowEventLine(match[1], match[2], match[3]) };

	if (currentListLabel) {
		match = line.match(/^- #(\d+)\s+(.+)$/);
		if (match) return { id: "latest", event: normalizeWorkflowEventLine(currentListLabel, match[1], match[2]) };
	}

	return null;
}

function workflowEventListLabel(line: string): string | undefined {
	const match = line.match(/^(Newly discovered|Newly unblocked\/takeable|Newly spawned|Newly done|New failure):$/);
	return match?.[1];
}

function isWorkflowNoiseLine(line: string, currentListLabel?: string): boolean {
	return parseCountLine(line) !== null || parsePhaseLine(line) !== null || parseTitleLine(line) !== null || parseWorkflowEventLine(line, currentListLabel) !== null || workflowEventListLabel(line) !== undefined || /^Spawning takeable tickets:?$/.test(line) || /^Waiting for (harness-delivered )?worker results\.?$/.test(line);
}

function sanitizeWorkflowText(text: string): string {
	let currentListLabel: string | undefined;
	const kept: string[] = [];
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		const nextListLabel = workflowEventListLabel(line);
		if (nextListLabel) {
			currentListLabel = nextListLabel;
			continue;
		}
		if (isWorkflowNoiseLine(line, currentListLabel)) continue;
		if (line && !line.startsWith("- #")) currentListLabel = undefined;
		kept.push(rawLine);
	}
	return kept.join("\n").trim();
}

function withTextContentShape(message: any, text: string): any {
	if (typeof message?.content === "string") return { ...message, content: text };
	if (!Array.isArray(message?.content)) return message;

	const content: any[] = [];
	let wroteText = false;
	for (const part of message.content) {
		if (part?.type !== "text") {
			content.push(part);
			continue;
		}
		if (!wroteText && text) content.push({ ...part, text });
		wroteText = true;
	}
	return { ...message, content };
}

function ingestText(text: string): boolean {
	let changed = false;
	let currentListLabel: string | undefined;
	let inCreatedTickets = false;
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;

		if (line === "created_tickets:") {
			inCreatedTickets = true;
			continue;
		}
		if (inCreatedTickets && line.startsWith("- #")) {
			const run = state.runs[0];
			if (run?.phase === "tickets") {
				run.counts.tickets = Number(run.counts.tickets ?? 0) + 1;
				run.updatedAt = now();
				changed = true;
			}
			continue;
		}
		if (inCreatedTickets && !line.startsWith("- #")) inCreatedTickets = false;

		const nextListLabel = workflowEventListLabel(line);
		if (nextListLabel) {
			currentListLabel = nextListLabel;
			continue;
		}

		const title = parseTitleLine(line);
		if (title) {
			const run = state.runs.find((candidate) => candidate.scope.endsWith(`#${title.issue}`));
			if (run) {
				run.title = title.title;
				run.updatedAt = now();
				changed = true;
			}
			continue;
		}

		const count = parseCountLine(line);
		if (count) {
			const run = findRun(count.id, count.kind, count.scope);
			run.summary = count.summary;
			run.counts = count.counts;
			run.alert = undefined;
			run.status = Number(count.counts.failed ?? 0) > 0 ? "failed" : Number(count.counts.closed ?? 0) === Number(count.counts.total ?? -1) ? "completed" : "running";
			changed = true;
			continue;
		}

		const alert = parseAlertLine(line);
		if (alert) {
			const run = state.runs[0];
			if (run) {
				run.alert = alert;
				run.updatedAt = now();
				changed = true;
			}
			continue;
		}

		const phase = parsePhaseLine(line);
		if (phase) {
			const run = findRun(phase.id, "2pr", phase.scope);
			run.phase = phase.phase;
			if (phase.title) run.title = phase.title;
			run.summary = phase.summary;
			run.status = "running";
			addEvent(run, line);
			changed = true;
			continue;
		}

		const workflowEvent = parseWorkflowEventLine(line, currentListLabel);
		if (workflowEvent) {
			const run = state.runs[0];
			if (run) {
				addEvent(run, workflowEvent.event);
				changed = true;
			}
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
	state.warnings = warnings;
}

function readConfig(ctx: ExtensionContext): DashboardConfig {
	try {
		return JSON.parse(fs.readFileSync(configFile(ctx), "utf8")) as DashboardConfig;
	} catch {
		return {};
	}
}

async function writeConfig(ctx: ExtensionContext, config: DashboardConfig): Promise<void> {
	const file = configFile(ctx);
	await fs.promises.mkdir(path.dirname(file), { recursive: true });
	await fs.promises.writeFile(file, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function configuredPlacement(ctx: ExtensionContext): "aboveEditor" | "belowEditor" | undefined {
	const config = readConfig(ctx);
	if (config.placement === "aboveEditor" || config.placement === "belowEditor") return config.placement;
	return undefined;
}

function isDashboardEnabled(ctx: ExtensionContext): boolean {
	return readConfig(ctx).enabled !== false;
}

async function setDashboardEnabled(ctx: ExtensionContext, enabled: boolean): Promise<void> {
	await writeConfig(ctx, { ...readConfig(ctx), enabled });
}

function runLabel(run: WorkflowRun): string {
	if (run.kind === "wayfinder") return "wayfinder dispatcher";
	if (run.kind === "implement") return "implementation dispatcher";
	if (run.kind === "code-review") return "code-review dispatcher";
	if (run.kind === "2pr" && run.phase === "spec") return "to-spec";
	if (run.kind === "2pr" && run.phase === "tickets") return "to-tickets";
	if (run.kind === "2pr" && run.phase === "branch") return "create branch";
	if (run.kind === "2pr" && run.phase === "pr") return "create PR";
	if (run.kind === "2pr") return "SPEC-to-PR";
	return "workflow";
}

function titleInfo(run: WorkflowRun): string {
	return `${runLabel(run)} · ${run.scope}`;
}

function infoText(value: string): string {
	return `${INFO_TEXT_FG}${value}${RESET_FG}`;
}

function alertText(theme: { fg(color: string, text: string): string }, value: string): string {
	return theme.fg("muted", value);
}

function issueNumberFromScope(scope: string): string | undefined {
	return scope.match(/#(\d+)$/)?.[1];
}

async function enrichMissingTitles(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	for (const run of state.runs) {
		const issueNumber = issueNumberFromScope(run.scope);
		if (!issueNumber || run.title) continue;
		try {
			const result = await pi.exec("gh", ["issue", "view", issueNumber, "--json", "title", "--jq", ".title"], { timeout: 5000, signal: ctx.signal });
			const title = result.stdout.trim();
			if (title && !run.title) run.title = title;
		} catch {
			// Title enrichment is best-effort; keep the scope fallback when gh is unavailable.
		}
	}
}

function displayTitle(run: WorkflowRun): string {
	return run.title ?? run.scope;
}

function formatElapsed(run: WorkflowRun): string | undefined {
	if (!run.startedAt) return undefined;
	const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(run.startedAt)) / 1000));
	const hours = Math.floor(elapsedSeconds / 3600);
	const minutes = Math.floor((elapsedSeconds % 3600) / 60);
	const seconds = elapsedSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function fitParts(parts: string[], maxWidth: number): string {
	const remaining = [...parts];
	while (remaining.length > 1 && visibleWidth(remaining.join(" · ")) > maxWidth) remaining.splice(remaining.length - 2, 1);
	return remaining.join(" · ");
}

function appendElapsed(run: WorkflowRun, parts: string[], maxWidth = Number.POSITIVE_INFINITY): string {
	const elapsed = formatElapsed(run);
	const allParts = elapsed ? [...parts, elapsed] : parts;
	return fitParts(allParts, maxWidth);
}

function statusChips(run: WorkflowRun, maxWidth = Number.POSITIVE_INFINITY): string {
	const c = run.counts;
	if (run.kind === "2pr" && run.phase === "spec") return appendElapsed(run, ["MAP complete", "creating SPEC"], maxWidth);
	if (run.kind === "2pr" && run.phase === "tickets") return appendElapsed(run, [c.tickets ? `${c.tickets} tickets` : "creating tickets", "creating"], maxWidth);
	if (run.kind === "code-review") return appendElapsed(run, [`iteration ${c.iteration ?? "?"}`, `${c.findings ?? "?"} findings`, `${c.fixes ?? "?"} fixes`], maxWidth);
	const parts: string[] = [];
	if (c.total !== undefined) parts.push(`${c.total} sub-issues`);
	for (const key of ["takeable", "running", "open", "closed", "blocked", "assigned", "failed"]) {
		const value = c[key];
		if (Number(value) > 0) parts.push(`${Number(value)} ${key}`);
	}
	return parts.length > 0 ? appendElapsed(run, parts, maxWidth) : appendElapsed(run, [run.status], maxWidth);
}

function compactSummary(run: WorkflowRun): string {
	return statusChips(run);
}

function isDashboardActive(): boolean {
	return workflowActiveThisSession && visibleThisSession && state.runs.length > 0;
}

function borderTop(title: string, info: string, width: number, accent: (value: string) => string): string {
	if (width <= 0) return "";
	if (width === 1) return accent("╭");
	const inner = Math.max(0, width - 2);
	const titlePart = `─ ${title} `;
	const infoPart = info ? ` ${info} ─` : "─";
	const fillLen = Math.max(0, inner - visibleWidth(titlePart) - visibleWidth(infoPart));
	const content = truncateToWidth(`${titlePart}${"─".repeat(fillLen)}${infoPart}`, inner, "").padEnd(inner, "─");
	return accent(`╭${content}╮`);
}

function borderLine(left: string, right: string, width: number, accent: (value: string) => string): string {
	if (width <= 0) return "";
	if (width === 1) return accent("│");
	const contentWidth = Math.max(0, width - 2);
	const rightWidth = visibleWidth(right);
	if (rightWidth >= contentWidth) return `${accent("│")}${truncateToWidth(right, contentWidth)}${accent("│")}`;
	const truncatedLeft = truncateToWidth(left, Math.max(0, contentWidth - rightWidth));
	const padding = Math.max(0, contentWidth - visibleWidth(truncatedLeft) - rightWidth);
	return `${accent("│")}${truncatedLeft}${" ".repeat(padding)}${right}${accent("│")}`;
}

function borderBottom(width: number, accent: (value: string) => string): string {
	if (width <= 0) return "";
	if (width === 1) return accent("╰");
	return accent(`╰${"─".repeat(Math.max(0, width - 2))}╯`);
}

function stopDashboardTimer(): void {
	if (!dashboardTimer) return;
	clearInterval(dashboardTimer);
	dashboardTimer = undefined;
}

function startDashboardTimer(requestRender: () => void): void {
	requestDashboardRender = requestRender;
	if (dashboardTimer) return;
	dashboardTimer = setInterval(() => requestDashboardRender?.(), 1000);
	dashboardTimer.unref?.();
}

function clearDashboard(ctx: ExtensionContext): void {
	stopDashboardTimer();
	dashboardWidgetMounted = false;
	dashboardWidgetPlacement = undefined;
	requestDashboardRender = undefined;
	if (!ctx.hasUI) return;
	ctx.ui.setWidget(EXTENSION_ID, undefined);
	ctx.ui.setStatus(EXTENSION_ID, undefined);
}

function renderDashboard(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	if (!isDashboardEnabled(ctx) || !isDashboardActive()) {
		clearDashboard(ctx);
		return;
	}

	const placement = configuredPlacement(ctx) ?? "aboveEditor";
	if (dashboardWidgetMounted && dashboardWidgetPlacement === placement) {
		requestDashboardRender?.();
		return;
	}

	dashboardWidgetMounted = true;
	dashboardWidgetPlacement = placement;
	ctx.ui.setWidget(EXTENSION_ID, (tui, theme) => {
		startDashboardTimer(() => tui.requestRender?.());
		return {
			invalidate() {},
			dispose() {
				stopDashboardTimer();
				dashboardWidgetMounted = false;
				dashboardWidgetPlacement = undefined;
				requestDashboardRender = undefined;
			},
			render(width: number): string[] {
				const accent = (value: string) => theme.fg("thinkingXhigh", value);
				const title = "Matt Pocock Workflow";
				const active = state.runs[0];
				const info = active ? titleInfo(active) : "";
				const lines: string[] = [borderTop(title, info, width, accent)];

				for (const run of state.runs.slice(0, 4)) {
					const left = infoText(` ${displayTitle(run)} `);
					const maxRightWidth = Math.max(0, width - 4);
					lines.push(borderLine(left, infoText(` ${statusChips(run, maxRightWidth - 2)} `), width, accent));
					if (run.alert) lines.push(borderLine(alertText(theme, ` ! ${run.alert} `), "", width, accent));
				}

				for (const warning of state.warnings.slice(0, 2)) lines.push(borderLine(infoText(` ! ${warning} `), "", width, accent));
				lines.push(borderBottom(width, accent));
				return lines.map((line) => truncateToWidth(line, width));
			},
		};
	}, { placement });

	ctx.ui.setStatus(EXTENSION_ID, undefined);
}

export default function mattpocockWorkflowDashboard(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		visibleThisSession = false;
		workflowActiveThisSession = false;
		activeRunIdsThisSession = new Set<string>();
		await loadState(ctx);
		clearDashboard(ctx);
	});

	pi.on("session_shutdown", async () => {
		stopDashboardTimer();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (workflowSkillIsActive(event)) {
			workflowActiveThisSession = true;
			return;
		}
		if (typeof (event as any)?.prompt === "string" && (event as any).prompt.trim()) deactivateWorkflowDashboard(ctx);
	});

	pi.on("tool_call", async (event) => {
		if (workflowAgentIsStarting(event)) workflowActiveThisSession = true;
	});

	pi.on("message_end", async (event, ctx) => {
		if (!isDashboardEnabled(ctx)) return;
		const message = (event as any).message;
		const text = collectTextFromMessage(message);
		const changed = Boolean(workflowActiveThisSession && text && ingestText(text));
		if (changed) {
			markDashboardVisible();
			await enrichMissingTitles(pi, ctx);
			updateWarnings(ctx);
			renderDashboard(ctx);
			await persistState(ctx);
		}
		if (!workflowActiveThisSession || message?.role !== "assistant" || !text) return;
		const sanitized = sanitizeWorkflowText(text);
		if (sanitized === text) return;
		return { message: withTextContentShape(message, sanitized) };
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!isDashboardEnabled(ctx) || !workflowActiveThisSession) return;
		const text = collectTextFromToolResult(event);
		if (!text || !ingestText(text)) return;
		markDashboardVisible();
		await enrichMissingTitles(pi, ctx);
		updateWarnings(ctx);
		renderDashboard(ctx);
		await persistState(ctx);
	});

	pi.registerCommand("workflow-dashboard", {
		description: "Show or configure the Matt Pocock workflow dashboard. Usage: /workflow-dashboard [on|off|toggle|status].",
		handler: async (_args, ctx) => {
			const command = _args.trim().toLowerCase();
			if (command === "off" || command === "disable") {
				await setDashboardEnabled(ctx, false);
				clearDashboard(ctx);
				ctx.ui.notify("Workflow dashboard disabled. Re-enable with /workflow-dashboard on.", "info");
				return;
			}

			if (command === "on" || command === "enable") {
				await setDashboardEnabled(ctx, true);
				workflowActiveThisSession = true;
				visibleThisSession = state.runs.length > 0;
				await enrichMissingTitles(pi, ctx);
				updateWarnings(ctx);
				renderDashboard(ctx);
				await persistState(ctx);
				ctx.ui.notify("Workflow dashboard enabled.", "info");
				return;
			}

			if (command === "toggle") {
				const enabled = !isDashboardEnabled(ctx);
				await setDashboardEnabled(ctx, enabled);
				if (enabled) {
					workflowActiveThisSession = true;
					visibleThisSession = state.runs.length > 0;
					await enrichMissingTitles(pi, ctx);
					updateWarnings(ctx);
					renderDashboard(ctx);
					await persistState(ctx);
					ctx.ui.notify("Workflow dashboard enabled.", "info");
				} else {
					clearDashboard(ctx);
					ctx.ui.notify("Workflow dashboard disabled. Re-enable with /workflow-dashboard on.", "info");
				}
				return;
			}

			await enrichMissingTitles(pi, ctx);
			updateWarnings(ctx);
			renderDashboard(ctx);
			await persistState(ctx);
			const enabled = isDashboardEnabled(ctx) ? "enabled" : "disabled";
			ctx.ui.notify(`Workflow dashboard ${enabled}: ${state.runs.length} run(s). Status file: ${statusFile(ctx)}`, "info");
		},
	});
}
