import { expect, test } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import { updatedText } from "./reading-text";

test("a reading under a minute old says just now, never 0 min", () => {
	expect(updatedText("Hourly average", 0)).toBe(
		m.current_source_updated_just_now({ average: "Hourly average" })
	);
	expect(updatedText("Hourly average", 0)).not.toContain("0 min");
});

test("an older reading says how many minutes", () => {
	expect(updatedText("Hourly average", 6)).toBe("Hourly average · updated 6 min ago");
});
