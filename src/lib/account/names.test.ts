import { describe, expect, it } from "vitest";
import { displayName, greetingName, initials } from "./names";

describe("name helpers", () => {
	it.each([
		["Maria Lopez", "ML", "Maria", "Maria Lopez"],
		["  maria  ", "M", "maria", "maria"],
		["Ana María de la Cruz", "AC", "Ana", "Ana María de la Cruz"],
		["李 小龙", "李小", "李", "李 小龙"],
		["🙂 Sam", "🙂S", "🙂", "🙂 Sam"]
	])("%j", (name, i, g, d) => {
		expect(initials(name)).toBe(i);
		expect(greetingName(name)).toBe(g);
		expect(displayName(name)).toBe(d);
	});

	it.each(["", "   "])("returns null for %j", (name) => {
		expect(initials(name)).toBeNull();
		expect(greetingName(name)).toBeNull();
		expect(displayName(name)).toBeNull();
	});
});
