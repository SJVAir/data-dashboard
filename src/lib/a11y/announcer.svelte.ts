/**
 * The polite live regions' text. The page has one region (`LiveRegion`, mounted once); every open
 * dialog adds its own (`LiveRegion layer="dialog"`, in the dialog's content), because content
 * outside an `aria-modal` dialog is cut off from screen readers while it is open. A message goes
 * to the topmost region only, and stays with it: closing that dialog drops the message rather
 * than moving it to the page's region, where it would be read again.
 */
const PAGE_REGION = 0;
let text = $state("");
let owner = $state(PAGE_REGION);
/** The dialog regions, oldest first; the last is the topmost open dialog's. */
const dialogRegions: number[] = [];
let nextRegion = 1;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * How long the region stays empty before the new text. Screen readers can merge a clear and a
 * set made one frame apart and skip a repeat, so the gap is longer than a frame.
 */
export const ANNOUNCE_GAP_MS = 100;

export const announcer = {
	/** The latest message, whichever region holds it. */
	get text(): string {
		return text;
	},
	/** The text for region `id` (`PAGE_REGION` for the page's): empty unless it holds the message. */
	textFor(id: number): string {
		return owner === id ? text : "";
	}
};

export { PAGE_REGION };

/** Adds an open dialog's region as the topmost. Call the returned function when it unmounts. */
export function registerDialogRegion(): { id: number; release: () => void } {
	const id = nextRegion++;
	dialogRegions.push(id);
	return {
		id,
		release() {
			const i = dialogRegions.indexOf(id);
			if (i !== -1) dialogRegions.splice(i, 1);
			if (owner === id) {
				text = "";
				owner = PAGE_REGION;
			}
		}
	};
}

/**
 * Read `message` politely, from the topmost region. The region is cleared first and set after a
 * short gap, so the same text twice in a row is read both times. A newer message replaces one
 * still waiting. With `onlyInDialog`, the message is dropped when no dialog is open by then: for
 * text with its own live region on the page (toasts), which a dialog cuts off.
 */
export function announce(message: string, options: { onlyInDialog?: boolean } = {}): void {
	text = "";
	clearTimeout(timer);
	timer = setTimeout(() => {
		const top = dialogRegions.at(-1);
		if (top === undefined && options.onlyInDialog) return;
		owner = top ?? PAGE_REGION;
		text = message;
	}, ANNOUNCE_GAP_MS);
}
