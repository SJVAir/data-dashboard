/** Words a day cell would show in full, below `above` single lines (its number, its value). */
export type CellWords = { text: string; above: number };

let context: CanvasRenderingContext2D | null | undefined;

/** A canvas to measure text with, in the cells' own font. */
function measurer(font: string): CanvasRenderingContext2D | null {
	if (context === undefined) context = document.createElement("canvas").getContext("2d");
	if (context) context.font = font;
	return context;
}

/** How many lines `text` takes at `width`, wrapping at spaces only; `Infinity` if a word won't fit. */
export function wrappedLines(text: string, width: number, measure: (s: string) => number): number {
	const words = text.split(/\s+/).filter(Boolean);
	const space = measure(" ");
	let lines = 0;
	let used = 0;
	for (const word of words) {
		const w = measure(word);
		if (w > width) return Infinity;
		if (lines > 0 && used + space + w <= width) {
			used += space + w;
		} else {
			lines += 1;
			used = w;
		}
	}
	return lines;
}

/**
 * Whether every one of `words` fits whole in the smallest of `cells`: no word wider than a cell's
 * content box, and its wrapped lines (plus those above) within the cell's height.
 */
export function wordsFit(cells: Iterable<HTMLElement>, words: CellWords[]): boolean {
	let width = Infinity;
	let height = Infinity;
	let sample: HTMLElement | undefined;
	for (const cell of cells) {
		sample ??= cell;
		width = Math.min(width, cell.clientWidth);
		height = Math.min(height, cell.clientHeight);
	}
	if (!sample || words.length === 0) return true;
	const style = getComputedStyle(sample);
	const contentWidth = width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
	const contentHeight = height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
	const fontSize = parseFloat(style.fontSize);
	const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2;
	const gap = parseFloat(style.rowGap) || 0;
	const ctx = measurer(style.font || `${style.fontSize} ${style.fontFamily}`);
	if (!ctx) return false;
	// A little slack: canvas and layout round text widths a bit differently.
	const measure = (s: string) => ctx.measureText(s).width + 0.5;
	return words.every(({ text, above }) => {
		const lines = above + wrappedLines(text, contentWidth, measure);
		return lines * lineHeight + (lines - 1) * gap <= contentHeight;
	});
}
