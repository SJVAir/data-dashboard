import { describe, expect, it } from "vitest";
import { meetsFloor } from "./browser-floor";

const yes = () => true;
const no = () => false;

describe("meetsFloor", () => {
	it("fails without a CSS object", () => {
		expect(meetsFloor(undefined)).toBe(false);
	});
	it("fails without registerProperty", () => {
		expect(meetsFloor({ supports: yes })).toBe(false);
	});
	it("fails without color-mix support", () => {
		expect(meetsFloor({ supports: no, registerProperty: () => {} })).toBe(false);
	});
	it("passes with both", () => {
		expect(meetsFloor({ supports: yes, registerProperty: () => {} })).toBe(true);
	});
});
