import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	AssistantMessageComponent,
	BashExecutionComponent,
	initTheme,
	InteractiveMode,
	ToolExecutionComponent,
	UserMessageComponent,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { acquireCalmModePatches } from "../src/calm-mode.ts";
import calmMode from "../src/extension.ts";

initTheme("dark", false);

const releases: Array<() => void> = [];

afterEach(() => {
	while (releases.length > 0) {
		releases.pop()?.();
	}
});

function assistantMessage(
	content: Parameters<AssistantMessageComponent["updateContent"]>[0]["content"],
	overrides: Partial<Parameters<AssistantMessageComponent["updateContent"]>[0]> = {},
): Parameters<AssistantMessageComponent["updateContent"]>[0] {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

describe("calm renderer patches", () => {
	it("suppresses only the tool-expansion status while preserving expansion behavior", () => {
		const interactive = InteractiveMode.prototype as unknown as Record<string, unknown>;
		const originalSetToolsExpanded = interactive.setToolsExpanded;
		releases.push(acquireCalmModePatches());
		const setToolsExpanded = interactive.setToolsExpanded as (this: Record<string, unknown>, expanded: boolean) => void;
		const expansionChanges: boolean[] = [];
		const statuses: string[] = [];
		const mode = {
			toolOutputExpanded: true,
			customHeader: { setExpanded: (expanded: boolean) => expansionChanges.push(expanded) },
			builtInHeader: undefined,
			loadedResourcesContainer: {
				children: [{ setExpanded: (expanded: boolean) => expansionChanges.push(expanded) }],
			},
			chatContainer: {
				children: [
					{ setExpanded: (expanded: boolean) => expansionChanges.push(expanded) },
					{},
				],
			},
			showStatus: (message: string) => statuses.push(message),
		} as unknown as Record<string, unknown>;

		setToolsExpanded.call(mode, false);

		assert.equal(mode.toolOutputExpanded, false);
		assert.deepEqual(expansionChanges, [false, false, false]);
		assert.deepEqual(statuses, []);
		(mode.showStatus as (message: string) => void)("Unrelated status");
		assert.deepEqual(statuses, ["Unrelated status"]);

		releases.pop()?.();
		assert.equal(interactive.setToolsExpanded, originalSetToolsExpanded);
	});

	it("hides ordinary model-tool rows but keeps subagent tooling visible", () => {
		const originalToolRender = ToolExecutionComponent.prototype.render;
		releases.push(acquireCalmModePatches());

		assert.deepEqual(ToolExecutionComponent.prototype.render.call({} as ToolExecutionComponent, 80), []);
		for (const toolName of ["subagent", "subagent_wait", "subagent_supervisor", "intercom"]) {
			const component = new ToolExecutionComponent(
				toolName,
				`call-${toolName}`,
				{},
				undefined,
				undefined,
				{ requestRender: () => {} } as never,
				process.cwd(),
			);
			assert.ok(component.render(80).length > 0, `${toolName} should remain visible`);
		}

		releases.pop()?.();
		assert.equal(ToolExecutionComponent.prototype.render, originalToolRender);
	});

	it("removes thinking while preserving assistant text and the original message", () => {
		releases.push(acquireCalmModePatches());
		const component = new AssistantMessageComponent();
		const message = assistantMessage([
			{ type: "thinking", thinking: "secret reasoning" },
			{ type: "text", text: "Visible answer" },
			{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "echo hidden" } },
		], { stopReason: "toolUse" });

		component.updateContent(message);
		const lines = component.render(40);
		const rendered = lines.join("\n");

		assert.match(rendered, /assistant/);
		assert.match(rendered, /Visible answer/);
		assert.match(rendered, /╭.*╮/);
		assert.match(rendered, /╰.*╯/);
		assert.ok(lines.every((line) => visibleWidth(line) <= 40), "boxed lines must fit the viewport");
		assert.doesNotMatch(rendered, /secret reasoning/);
		assert.equal(message.content.length, 3, "the persisted/model message must not be mutated");
		assert.equal(message.stopReason, "toolUse");
	});

	it("fills historical hidden-only turns with a neutral assistant placeholder", () => {
		releases.push(acquireCalmModePatches());
		const toolOnly = new AssistantMessageComponent();
		toolOnly.updateContent(assistantMessage([
			{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "secret command" } },
		], { stopReason: "toolUse" }));
		const toolOnlyOutput = toolOnly.render(60).join("\n");

		assert.match(toolOnlyOutput, /assistant/);
		assert.match(toolOnlyOutput, /Activity hidden/);
		assert.doesNotMatch(toolOnlyOutput, /bash|secret command/);

		const reasoningOnly = new AssistantMessageComponent();
		reasoningOnly.updateContent(assistantMessage([
			{ type: "thinking", thinking: "private chain of thought" },
		]));
		reasoningOnly.invalidate(); // Theme changes rebuild from the filtered renderer view.
		const reasoningOnlyOutput = reasoningOnly.render(60).join("\n");
		assert.match(reasoningOnlyOutput, /Activity hidden/);
		assert.doesNotMatch(reasoningOnlyOutput, /private chain of thought/);
	});

	it("does not add a hidden-activity placeholder when a subagent row is visible", () => {
		releases.push(acquireCalmModePatches());
		const component = new AssistantMessageComponent();
		component.updateContent(assistantMessage([
			{ type: "toolCall", id: "call-subagent", name: "subagent", arguments: { agent: "worker" } },
		], { stopReason: "toolUse" }));

		assert.deepEqual(component.render(60), []);
	});

	it("preserves normal assistant error rendering after filtering thinking", () => {
		releases.push(acquireCalmModePatches());
		const component = new AssistantMessageComponent();
		component.updateContent(assistantMessage(
			[{ type: "thinking", thinking: "hidden reasoning" }],
			{ stopReason: "error", errorMessage: "provider failed" },
		));

		const rendered = component.render(120).join("\n");
		assert.match(rendered, /provider failed/);
		assert.doesNotMatch(rendered, /hidden reasoning/);
	});

	it("does not patch user messages or user-invoked bash output", () => {
		const originalUserRender = UserMessageComponent.prototype.render;
		const originalBashRender = BashExecutionComponent.prototype.render;
		releases.push(acquireCalmModePatches());

		assert.equal(UserMessageComponent.prototype.render, originalUserRender);
		assert.equal(BashExecutionComponent.prototype.render, originalBashRender);
		const userMessage = new UserMessageComponent("Visible prompt");
		assert.match(userMessage.render(120).join("\n"), /Visible prompt/);
	});

	it("reference-counts duplicate extension owners", () => {
		const original = ToolExecutionComponent.prototype.render;
		const releaseOne = acquireCalmModePatches();
		const releaseTwo = acquireCalmModePatches();

		releaseOne();
		assert.notEqual(ToolExecutionComponent.prototype.render, original);
		releaseTwo();
		assert.equal(ToolExecutionComponent.prototype.render, original);
	});
});

describe("extension lifecycle", () => {
	it("installs eagerly and restores patches on shutdown", () => {
		const handlers = new Map<string, () => void>();
		const pi = {
			on: (name: string, handler: () => void) => handlers.set(name, handler),
		} as unknown as ExtensionAPI;
		const originalToolRender = ToolExecutionComponent.prototype.render;

		calmMode(pi);
		assert.notEqual(ToolExecutionComponent.prototype.render, originalToolRender);
		handlers.get("session_shutdown")?.();
		assert.equal(ToolExecutionComponent.prototype.render, originalToolRender);
	});
});
