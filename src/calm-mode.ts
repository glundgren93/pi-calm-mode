import {
	AssistantMessageComponent,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";

const PATCH_STATE_KEY = Symbol.for("pi-calm-mode.prototype-patches.v2");

interface PatchState {
	owners: number;
	restore: () => void;
}

type RuntimeMethod = (this: unknown, ...args: unknown[]) => unknown;
type RuntimePrototype = Record<string, unknown>;
type AssistantMessage = Parameters<AssistantMessageComponent["updateContent"]>[0];

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

function installPrototypePatches(): () => void {
	const restorers: Array<() => void> = [];

	// ToolExecutionComponent owns the complete model-tool row: pending call,
	// arguments, result text, errors, diffs, and tool-returned images.
	restorers.push(
		replaceMethod(asPrototype(ToolExecutionComponent.prototype), "render", () => function hiddenToolRender() {
			return [];
		}),
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
				const visibleMessage: AssistantMessage = {
					...message,
					content: message.content.filter((block) => block.type !== "thinking"),
				};
				return previous.call(this, visibleMessage);
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
		restore: installPrototypePatches(),
	};
	store[PATCH_STATE_KEY] = state;
	return () => releasePatchOwner(store, state);
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
