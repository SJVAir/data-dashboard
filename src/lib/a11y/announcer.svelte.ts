/**
 * The polite live regions' text. The page has one region (`LiveRegion`, mounted once); every open
 * dialog adds its own (`LiveRegion layer="dialog"`, in the dialog's content), because content
 * outside an `aria-modal` dialog is cut off from screen readers while it is open. A message goes
 * to the topmost open dialog's region, or the page's when no dialog is open, and stays with it:
 * a dialog that starts closing drops the message it holds rather than moving it to the page's
 * region, where it would be read again.
 *
 * A dialog counts as open until it starts closing. While a closing dialog is still on screen (its
 * close animation) the page's region is still cut off, so a message for the page waits until it
 * is gone.
 */
const PAGE_REGION = 0;
let text = $state("");
let owner = $state(PAGE_REGION);
/** The open dialogs' regions, oldest first; the last is the topmost open dialog's. */
const openRegions: number[] = [];
/** Regions of dialogs that started closing but are still on screen. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not rendered
const closingRegions = new Set<number>();
let nextRegion = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
/** A message for the page's region, waiting for closing dialogs to leave the screen. */
let waiting: string | null = null;

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

function remove(id: number): void {
	const i = openRegions.indexOf(id);
	if (i !== -1) openRegions.splice(i, 1);
}

/** Drops the message `id` holds (it isn't moved, so it isn't read twice). */
function drop(id: number): void {
	if (owner === id) {
		text = "";
		owner = PAGE_REGION;
	}
}

/** Sets `message` in the topmost open region, or the page's once no closing dialog covers it. */
function deliver(message: string): void {
	const top = openRegions.at(-1);
	if (top !== undefined) {
		owner = top;
		text = message;
	} else if (closingRegions.size > 0) {
		waiting = message;
	} else {
		owner = PAGE_REGION;
		text = message;
	}
}

/**
 * Adds an open dialog's region as the topmost. Call `setOpen(false)` when the dialog starts
 * closing (and `setOpen(true)` if it opens again before it's gone), and `release` when it unmounts.
 */
export function registerDialogRegion(): {
	id: number;
	setOpen: (open: boolean) => void;
	release: () => void;
} {
	const id = nextRegion++;
	openRegions.push(id);
	return {
		id,
		setOpen(open) {
			if (open) {
				if (!closingRegions.delete(id)) return;
				openRegions.push(id);
			} else {
				if (!openRegions.includes(id)) return;
				remove(id);
				closingRegions.add(id);
				drop(id);
			}
		},
		release() {
			remove(id);
			closingRegions.delete(id);
			drop(id);
			if (closingRegions.size === 0 && waiting !== null) {
				const message = waiting;
				waiting = null;
				deliver(message);
			}
		}
	};
}

/**
 * Read `message` politely, from the topmost open region. The region is cleared first and set
 * after a short gap, so the same text twice in a row is read both times. A newer message replaces
 * one still waiting.
 *
 * `onlyInDialog` is for text with its own live region on the page (toasts), which a dialog cuts
 * off: with no dialog on screen at the call, that region reads it, so it is read here only if a
 * dialog opens within the gap (and it doesn't cancel a message already waiting). With a dialog on
 * screen at the call, the page's own copy wasn't heard, so it's read here even if the dialog has
 * closed by then (from the page's region).
 */
export function announce(message: string, options: { onlyInDialog?: boolean } = {}): void {
	if (options.onlyInDialog && openRegions.length === 0 && closingRegions.size === 0) {
		setTimeout(() => {
			if (openRegions.length > 0) deliver(message);
		}, ANNOUNCE_GAP_MS);
		return;
	}
	text = "";
	waiting = null;
	clearTimeout(timer);
	timer = setTimeout(() => deliver(message), ANNOUNCE_GAP_MS);
}
