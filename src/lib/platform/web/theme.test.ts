import { describe, expect, it } from "vitest";
import { createMemoryPlatform } from "../memory";
import type { ThemeChoice } from "../types";
import { readThemeChoice, writeThemeChoice } from "./theme";

function fakeStorage(initial: Record<string, string> = {}): Storage {
	const data = new Map(Object.entries(initial));
	return {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
		key: (i: number) => [...data.keys()][i] ?? null,
		removeItem: (k: string) => void data.delete(k),
		setItem: (k: string, v: string) => void data.set(k, String(v))
	};
}

const KEY = "sjvair-workspace:theme";

describe("readThemeChoice", () => {
	it("is system for null storage, a missing key, or an unknown value", () => {
		expect(readThemeChoice(null)).toBe("system");
		expect(readThemeChoice(fakeStorage())).toBe("system");
		expect(readThemeChoice(fakeStorage({ [KEY]: "sepia" }))).toBe("system");
	});

	it("is system when getItem throws", () => {
		const s = fakeStorage();
		s.getItem = () => {
			throw new Error("blocked");
		};
		expect(readThemeChoice(s)).toBe("system");
	});

	it("round-trips each choice", () => {
		for (const choice of ["light", "dark", "system"] as ThemeChoice[]) {
			const s = fakeStorage();
			writeThemeChoice(s, choice);
			expect(readThemeChoice(s)).toBe(choice);
		}
	});
});

describe("writeThemeChoice", () => {
	it("swallows a throwing setItem and null storage", () => {
		const s = fakeStorage();
		s.setItem = () => {
			throw new Error("quota");
		};
		expect(() => writeThemeChoice(s, "dark")).not.toThrow();
		expect(() => writeThemeChoice(null, "dark")).not.toThrow();
	});
});

describe("memory platform display", () => {
	it("round-trips and notifies until stopped", () => {
		const { display } = createMemoryPlatform();
		const heard: ThemeChoice[] = [];
		const stop = display.onThemeChange((c) => heard.push(c));
		expect(display.theme()).toBe("system");
		display.setTheme("dark");
		expect(display.theme()).toBe("dark");
		stop();
		display.setTheme("light");
		expect(heard).toEqual(["dark"]);
	});
});
