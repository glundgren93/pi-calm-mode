import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { acquireCalmModePatches } from "./calm-mode.ts";

export default function calmMode(pi: ExtensionAPI): void {
	// Install immediately so initial and resumed transcript rendering is filtered.
	let releasePatches: (() => void) | undefined = acquireCalmModePatches();

	pi.on("session_shutdown", () => {
		releasePatches?.();
		releasePatches = undefined;
	});
}
