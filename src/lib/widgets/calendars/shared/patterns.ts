import { parseToRgba } from "color2k";
import { readableColor } from "$lib/color";

/**
 * The readable ink (black or white) on a level color, as an `r,g,b` triplet for `tierPattern`.
 */
export function inkOf(color: string): string {
	const [r, g, b] = parseToRgba(readableColor(color));
	return `${r},${g},${b}`;
}

/**
 * A level tier's pattern, as CSS background layers (image, then position / size) drawn in `ink`
 * (an `r,g,b` triplet): tier 1 dots on a 5 px grid, 2 diagonal stripes, 3 cross-hatch, 4 and up
 * horizontal lines. The lowest tier, or none, is plain (`null`).
 */
export function tierPattern(tier: number | null, ink: string): string | null {
	if (tier === null || tier <= 0) return null;
	const c = `rgb(${ink})`;
	const lines = (angle: string) =>
		`repeating-linear-gradient(${angle}, ${c} 0 1px, transparent 1px 4px)`;
	switch (tier) {
		case 1:
			return `radial-gradient(circle, ${c} 0.9px, transparent 1.3px) 0 0 / 5px 5px`;
		case 2:
			return lines("45deg");
		case 3:
			return `${lines("45deg")}, ${lines("-45deg")}`;
		default:
			return lines("0deg");
	}
}
