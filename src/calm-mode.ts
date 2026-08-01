import {
	AssistantMessageComponent,
	InteractiveMode,
	ToolExecutionComponent,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const PATCH_STATE_KEY = Symbol.for("pi-calm-mode.prototype-patches.v5");
const ASSISTANT_PRESENTATION_KEY = Symbol.for("pi-calm-mode.assistant-presentation.v1");
const TOOL_OUTPUT_STATUS = /^Tool output: (?:expanded|collapsed)$/;
const PROMPT_ZONE_PATTERN = /\x1b\](?:133|633);[A-Z](?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/g;
const ANSI_CSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const MIN_ASSISTANT_BOX_WIDTH = 8;
const ASSISTANT_TITLE = " assistant ";
const HIDDEN_ACTIVITY_PLACEHOLDER = "Activity hidden";
const VISIBLE_SUBAGENT_TOOLS = new Set([
	"subagent",
	"subagent_wait",
	"subagent_supervisor",
	"intercom",
]);

interface PatchState {
	owners: number;
	theme?: Theme;
	restore: () => void;
}

interface AssistantPresentationState {
	visibleMessage: AssistantMessage;
	needsPlaceholder: boolean;
}

type RuntimeMethod = (this: unknown, ...args: unknown[]) => unknown;
type RuntimePrototype = Record<string, unknown>;
type RuntimeObject = Record<PropertyKey, unknown>;
type AssistantMessage = Parameters<AssistantMessageComponent["updateContent"]>[0];
type ThemeColor = "accent" | "border" | "muted";

function asPrototype(value: object): RuntimePrototype {
	return value as RuntimePrototype;
}

function replaceMethod(
	target: RuntimePrototype,
	key: string,
	createReplacement: (previous: RuntimeMethod) => RuntimeMethod,
): () => void {
	const previous = target[key];
	if (typeof previous !== "function") {
		return () => {};
	}

	const replacement = createReplacement(previous as RuntimeMethod);
	target[key] = replacement;

	return () => {
		if (target[key] === replacement) {
			target[key] = previous;
		}
	};
}

function themeForeground(theme: Theme | undefined, color: ThemeColor, text: string): string {
	if (!theme || !text) {
		return text;
	}
	try {
		return theme.fg(color, text);
	} catch {
		return text;
	}
}

function themeBold(theme: Theme | undefined, text: string): string {
	if (!theme || !text) {
		return text;
	}
	try {
		return theme.bold(text);
	} catch {
		return text;
	}
}

function stripPromptZones(line: string): string {
	return line.replace(PROMPT_ZONE_PATTERN, "");
}

function isVisuallyEmpty(line: string): boolean {
	return stripPromptZones(line).replace(ANSI_CSI_PATTERN, "").trim().length === 0;
}

function trimEmptyEdgeLines(lines: string[]): string[] {
	let start = 0;
	while (start < lines.length && isVisuallyEmpty(lines[start] ?? "")) {
		start += 1;
	}

	let end = lines.length;
	while (end > start && isVisuallyEmpty(lines[end - 1] ?? "")) {
		end -= 1;
	}

	return lines.slice(start, end).map(stripPromptZones);
}

function buildAssistantTopBorder(width: number, theme: Theme | undefined): string {
	const innerWidth = Math.max(0, width - 2);
	const title = truncateToWidth(ASSISTANT_TITLE, innerWidth, "");
	const fill = "─".repeat(Math.max(0, innerWidth - visibleWidth(title)));
	return `${themeForeground(theme, "border", "╭")}${themeForeground(theme, "accent", themeBold(theme, title))}${themeForeground(theme, "border", `${fill}╮`)}`;
}

function buildAssistantBottomBorder(width: number, theme: Theme | undefined): string {
	const innerWidth = Math.max(0, width - 2);
	return themeForeground(theme, "border", `╰${"─".repeat(innerWidth)}╯`);
}

function wrapAssistantBodyLine(line: string, width: number, theme: Theme | undefined): string {
	const contentWidth = Math.max(1, width - 4);
	const content = truncateToWidth(line, contentWidth, "", true);
	const fill = " ".repeat(Math.max(0, contentWidth - visibleWidth(content)));
	const border = (text: string) => themeForeground(theme, "border", text);
	return `${border("│")} ${content}${fill} ${border("│")}`;
}

function renderAssistantBox(
	lines: string[],
	width: number,
	theme: Theme | undefined,
	showPlaceholder: boolean,
): string[] {
	const safeWidth = Math.max(0, Math.floor(width));
	let body = trimEmptyEdgeLines(lines);
	if (body.length === 0 && showPlaceholder) {
		body = [themeForeground(theme, "muted", HIDDEN_ACTIVITY_PLACEHOLDER)];
	}
	if (body.length === 0) {
		return [];
	}
	if (safeWidth < MIN_ASSISTANT_BOX_WIDTH) {
		return body.map((line) => truncateToWidth(line, safeWidth, "", true));
	}

	const output = [
		"",
		`${OSC133_ZONE_START}${buildAssistantTopBorder(safeWidth, theme)}`,
		wrapAssistantBodyLine("", safeWidth, theme),
		...body.map((line) => wrapAssistantBodyLine(line, safeWidth, theme)),
		wrapAssistantBodyLine("", safeWidth, theme),
		`${OSC133_ZONE_END}${OSC133_ZONE_FINAL}${buildAssistantBottomBorder(safeWidth, theme)}`,
	];
	return output;
}

function needsHiddenActivityPlaceholder(message: AssistantMessage): boolean {
	const toolCalls = message.content.filter((block) => block.type === "toolCall");
	const hasVisibleSubagent = toolCalls.some((block) => VISIBLE_SUBAGENT_TOOLS.has(block.name));
	if (hasVisibleSubagent) {
		return false;
	}

	const hasHiddenTool = toolCalls.length > 0;
	const hasHiddenThinking = message.content.some(
		(block) => block.type === "thinking" && block.thinking.trim().length > 0,
	);
	return hasHiddenTool || hasHiddenThinking;
}

function installPrototypePatches(getTheme: () => Theme | undefined): () => void {
	const restorers: Array<() => void> = [];

	// Keep expansion behavior intact, but suppress the status row generated by
	// the tool-output toggle. Other calls to showStatus remain untouched.
	restorers.push(
		replaceMethod(
			asPrototype(InteractiveMode.prototype),
			"setToolsExpanded",
			(previous) => function setToolsExpandedWithoutStatus(...args: unknown[]) {
				const instance = this as RuntimePrototype;
				const showStatus = instance.showStatus;
				if (typeof showStatus !== "function") {
					return previous.apply(this, args);
				}

				const ownDescriptor = Object.getOwnPropertyDescriptor(instance, "showStatus");
				const filteredShowStatus: RuntimeMethod = function filteredToolOutputStatus(message, ...statusArgs) {
					if (typeof message === "string" && TOOL_OUTPUT_STATUS.test(message)) {
						return;
					}
					return (showStatus as RuntimeMethod).call(this, message, ...statusArgs);
				};
				Object.defineProperty(instance, "showStatus", {
					configurable: true,
					writable: true,
					value: filteredShowStatus,
				});

				try {
					return previous.apply(this, args);
				} finally {
					if (instance.showStatus === filteredShowStatus) {
						if (ownDescriptor) {
							Object.defineProperty(instance, "showStatus", ownDescriptor);
						} else {
							delete instance.showStatus;
						}
					}
				}
			},
		),
	);

	// ToolExecutionComponent owns the complete model-tool row: pending call,
	// arguments, result text, errors, diffs, and tool-returned images. Preserve
	// subagent orchestration rows so delegated work and its lifecycle stay visible.
	restorers.push(
		replaceMethod(
			asPrototype(ToolExecutionComponent.prototype),
			"render",
			(previous) => function selectivelyHiddenToolRender(width: unknown) {
				const toolName = (this as RuntimePrototype).toolName;
				if (typeof toolName === "string" && VISIBLE_SUBAGENT_TOOLS.has(toolName)) {
					return previous.call(this, width);
				}
				return [];
			},
		),
	);

	// Remove only thinking/reasoning blocks from the renderer's cloned view.
	// Text and tool-call blocks stay present so Pi preserves normal spacing,
	// stop/error handling, and tool lifecycle behavior. The original message and
	// session context are never mutated.
	restorers.push(
		replaceMethod(
			asPrototype(AssistantMessageComponent.prototype),
			"updateContent",
			(previous) => function assistantWithoutThinking(messageValue: unknown) {
				const message = messageValue as AssistantMessage;
				const instance = this as RuntimeObject;
				const existing = instance[ASSISTANT_PRESENTATION_KEY] as AssistantPresentationState | undefined;
				if (existing?.visibleMessage === message) {
					return previous.call(this, message);
				}

				const visibleMessage: AssistantMessage = {
					...message,
					content: message.content.filter((block) => block.type !== "thinking"),
				};
				instance[ASSISTANT_PRESENTATION_KEY] = {
					visibleMessage,
					needsPlaceholder: needsHiddenActivityPlaceholder(message),
				} satisfies AssistantPresentationState;
				return previous.call(this, visibleMessage);
			},
		),
	);

	// Frame assistant output at render time so historical and streaming messages
	// receive the same presentation without changing stored conversation data.
	restorers.push(
		replaceMethod(
			asPrototype(AssistantMessageComponent.prototype),
			"render",
			(previous) => function boxedAssistantRender(widthValue: unknown) {
				const width = typeof widthValue === "number" ? widthValue : 0;
				const contentWidth = width >= MIN_ASSISTANT_BOX_WIDTH ? Math.max(1, Math.floor(width) - 4) : width;
				const rendered = previous.call(this, contentWidth);
				if (!Array.isArray(rendered) || !rendered.every((line) => typeof line === "string")) {
					return rendered;
				}
				const presentation = (this as RuntimeObject)[ASSISTANT_PRESENTATION_KEY] as AssistantPresentationState | undefined;
				return renderAssistantBox(rendered, width, getTheme(), presentation?.needsPlaceholder ?? false);
			},
		),
	);

	return () => {
		for (const restore of restorers.reverse()) {
			restore();
		}
	};
}

/**
 * Install process-wide renderer patches. Reference counting makes duplicate
 * package entries and Pi reloads safe within the same process.
 */
export function acquireCalmModePatches(): () => void {
	const store = globalThis as unknown as Record<PropertyKey, unknown>;
	const existing = store[PATCH_STATE_KEY] as PatchState | undefined;
	if (existing) {
		existing.owners += 1;
		return () => releasePatchOwner(store, existing);
	}

	const state: PatchState = {
		owners: 1,
		restore: () => {},
	};
	state.restore = installPrototypePatches(() => state.theme);
	store[PATCH_STATE_KEY] = state;
	return () => releasePatchOwner(store, state);
}

/** Update the theme used by assistant response boxes. */
export function setCalmModeTheme(theme: Theme | undefined): void {
	const store = globalThis as unknown as Record<PropertyKey, unknown>;
	const state = store[PATCH_STATE_KEY] as PatchState | undefined;
	if (state) {
		state.theme = theme;
	}
}

function releasePatchOwner(store: Record<PropertyKey, unknown>, state: PatchState): void {
	if (store[PATCH_STATE_KEY] !== state || state.owners <= 0) {
		return;
	}

	state.owners -= 1;
	if (state.owners > 0) {
		return;
	}

	state.restore();
	delete store[PATCH_STATE_KEY];
}
