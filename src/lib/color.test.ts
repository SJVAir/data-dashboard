import { expect, test } from "vitest";
import { readableColor } from "./color";

test("readableColor picks black text on a light background", () => {
	expect(readableColor("#ffff00")).toBe("#000000");
});

test("readableColor picks white text on a dark background", () => {
	expect(readableColor("#7e0023")).toBe("#ffffff");
});
