import { expect, test } from "vitest";
import { createMemoryPlatform } from "$lib/platform/memory";
import { boot } from "./boot";

function target(): HTMLElement {
	const el = document.createElement("div");
	document.body.append(el);
	return el;
}

test("a failed platform init shows the storage message", async () => {
	const el = target();
	await boot({
		target: el,
		createPlatform: () => Promise.reject(new DOMException("denied", "InvalidStateError")),
		start: () => Promise.resolve()
	});
	expect(el.textContent).toContain("This browser isn't letting SJVAir Dashboard save anything");
	el.remove();
});

test("a blocked open shows the close-other-tabs message until it opens", async () => {
	const el = target();
	let open!: () => void;
	let started = false;
	const booting = boot({
		target: el,
		createPlatform: ({ onBlocked }) =>
			new Promise((resolve) => {
				onBlocked();
				open = () => resolve(createMemoryPlatform());
			}),
		start: async () => {
			started = true;
		}
	});
	await expect.poll(() => el.textContent).toContain("close other SJVAir Dashboard tabs");
	open();
	await booting;
	expect(started).toBe(true);
	expect(el.textContent).toBe("");
	el.remove();
});

test("a failure in start shows the startup message and is reported", async () => {
	const el = target();
	const platform = createMemoryPlatform();
	const failure = new Error("boom");
	await boot({
		target: el,
		createPlatform: () => Promise.resolve(platform),
		start: () => Promise.reject(failure)
	});
	expect(el.textContent).toContain("Something went wrong while starting SJVAir Dashboard");
	expect(el.textContent).not.toContain("isn't letting SJVAir Dashboard save");
	expect(platform.errors.reports).toEqual([{ error: failure, context: { operation: "start" } }]);
	el.remove();
});
