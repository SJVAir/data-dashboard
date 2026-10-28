/** The text in the page's polite live region (`LiveRegion`, mounted once). */
let text = $state("");
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * How long the region stays empty before the new text. Screen readers can merge a clear and a
 * set made one frame apart and skip a repeat, so the gap is longer than a frame.
 */
export const ANNOUNCE_GAP_MS = 100;

export const announcer = {
	get text(): string {
		return text;
	}
};

/**
 * Read `message` politely. The region is cleared first and set after a short gap, so the same
 * text twice in a row is read both times. A newer message replaces one still waiting.
 */
export function announce(message: string): void {
	text = "";
	clearTimeout(timer);
	timer = setTimeout(() => {
		text = message;
	}, ANNOUNCE_GAP_MS);
}
