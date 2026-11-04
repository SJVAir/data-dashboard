import "../../app.css";
import { afterEach, expect, test } from "vitest";

afterEach(() => {
	document.body.innerHTML = "";
});

test("native radios and checkboxes use navy, not the browser's accent", () => {
	const probe = document.createElement("span");
	probe.style.color = "var(--primary)";
	const radio = Object.assign(document.createElement("input"), { type: "radio" });
	const checkbox = Object.assign(document.createElement("input"), { type: "checkbox" });
	document.body.append(probe, radio, checkbox);
	const navy = getComputedStyle(probe).color;
	expect(getComputedStyle(radio).accentColor).toBe(navy);
	expect(getComputedStyle(checkbox).accentColor).toBe(navy);
});
