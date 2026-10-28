/** The text in the page's polite live region (`LiveRegion`, mounted once). */
let text = $state("");
let frame = 0;

const nextFrame =
	typeof requestAnimationFrame === "function"
		? requestAnimationFrame
		: (cb: () => void) => setTimeout(cb, 16) as unknown as number;
const cancelFrame =
	typeof cancelAnimationFrame === "function"
		? cancelAnimationFrame
		: (id: number) => clearTimeout(id);

export const announcer = {
	get text(): string {
		return text;
	}
};

/**
 * Read `message` politely. The region is cleared first and set on the next frame, so the same
 * text twice in a row is read both times.
 */
export function announce(message: string): void {
	text = "";
	cancelFrame(frame);
	frame = nextFrame(() => {
		text = message;
	});
}
