import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn with the project's custom utilities", () => {
	it("keeps text-field when a text color follows", () => {
		expect(cn("text-field md:text-sm", "text-foreground")).toBe(
			"text-field md:text-sm text-foreground"
		);
	});
	it("lets a later font size replace text-field", () => {
		expect(cn("text-field", "text-sm")).toBe("text-sm");
	});
	it("treats shadow-card as a shadow", () => {
		expect(cn("shadow-card", "shadow-lg")).toBe("shadow-lg");
		expect(cn("shadow-lg", "shadow-card")).toBe("shadow-card");
	});
	it("treats duration-fast and duration-base as durations", () => {
		expect(cn("duration-fast", "duration-base")).toBe("duration-base");
		expect(cn("duration-200", "duration-fast")).toBe("duration-fast");
	});
	it("treats ease-standard as an easing", () => {
		expect(cn("ease-in", "ease-standard")).toBe("ease-standard");
	});
});
