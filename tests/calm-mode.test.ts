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

	it("hides the complete model-tool row", () => {
		const originalToolRender = ToolExecutionComponent.prototype.render;
		releases.push(acquireCalmModePatches());

		assert.deepEqual(ToolExecutionComponent.prototype.render.call({} as ToolExecutionComponent, 80), []);

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
		const rendered = component.render(120).join("\n");

		assert.match(rendered, /Visible answer/);
		assert.doesNotMatch(rendered, /secret reasoning/);
		assert.equal(message.content.length, 3, "the persisted/model message must not be mutated");
		assert.equal(message.stopReason, "toolUse");
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
