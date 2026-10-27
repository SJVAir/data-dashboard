import { readableColorIsBlack } from "color2k";

/** Black or white, whichever reads better as text on the given background color. */
export function readableColor(background: string): "#000000" | "#ffffff" {
	return readableColorIsBlack(background) ? "#000000" : "#ffffff";
}
