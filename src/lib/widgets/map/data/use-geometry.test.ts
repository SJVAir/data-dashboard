import { describe, expect, it } from "vitest";
import {
	contains,
	padBounds,
	sectionZoom,
	townshipBlock,
	townshipOfSection,
	unionBounds
} from "./use-geometry";

type Box = [number, number, number, number];

const W = 0.108;
const H = 0.087;

function grid(rows: number, cols: number, shift?: { r: number; c: number }) {
	const map = new Map<string, Box>();
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const dx = shift && shift.r === r && shift.c === c ? 0.01 : 0;
			const west = -120 + c * W + dx;
			const south = 36 + r * H + dx;
			map.set(`MDM-T${r}S-R${c}E`, [west, south, west + W, south + H]);
		}
	}
	return map;
}

describe("sectionZoom", () => {
	it("is 11 for a small tile and rises for a big one", () => {
		expect(sectionZoom(400, 300, 36.7)).toBe(11);
		expect(sectionZoom(2560, 1440, 36.7)).toBeGreaterThanOrEqual(12);
	});
});

describe("townshipOfSection", () => {
	it("strips the section number", () => {
		expect(townshipOfSection("MDM-T12S-R19E-35")).toBe("MDM-T12S-R19E");
	});
});

describe("townshipBlock", () => {
	it("gives the 3 x 3 block, fewer at an edge, and survives a survey offset", () => {
		const townships = grid(5, 5);
		expect(townshipBlock("MDM-T2S-R2E", townships)).toHaveLength(9);
		expect(townshipBlock("MDM-T0S-R0E", townships)).toHaveLength(4);
		const shifted = grid(5, 5, { r: 1, c: 1 });
		const block = townshipBlock("MDM-T2S-R2E", shifted);
		expect(block).toHaveLength(9);
		expect(block).toContain("MDM-T2S-R2E");
		expect(townshipBlock("nope", townships)).toEqual([]);
	});
});

describe("padBounds and contains", () => {
	it("pads by half a view, and contains", () => {
		const b = { west: 0, south: 0, east: 2, north: 4 };
		const padded = padBounds(b, 0.5);
		expect(padded).toEqual({ west: -1, south: -2, east: 3, north: 6 });
		expect(contains(padded, b)).toBe(true);
		expect(contains(b, padded)).toBe(false);
	});

	it("unions bounds", () => {
		expect(
			unionBounds([
				{ west: 0, south: 0, east: 1, north: 1 },
				{ west: -1, south: 0.5, east: 0.5, north: 3 }
			])
		).toEqual({ west: -1, south: 0, east: 1, north: 3 });
	});
});
