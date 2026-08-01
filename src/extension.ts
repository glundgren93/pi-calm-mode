import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { acquireCalmModePatches, setCalmModeTheme } from "./calm-mode.ts";

export default function calmMode(pi: ExtensionAPI): void {
	// Install immediately so initial and resumed transcript rendering is filtered.
	let releasePatches: (() => void) | undefined = acquireCalmModePatches();
	const refreshTheme = (ctx: ExtensionContext): void => {
		if (ctx.mode === "tui") {
			setCalmModeTheme(ctx.ui.theme);
		}
	};

	pi.on("session_start", (_event, ctx) => refreshTheme(ctx));
	pi.on("before_agent_start", (_event, ctx) => refreshTheme(ctx));
	pi.on("session_shutdown", () => {
		releasePatches?.();
		releasePatches = undefined;
	});
}
