import "../../app.css";
import { afterEach, describe, expect, it } from "vitest";
import { commands } from "vitest/browser";

declare module "vitest/browser" {
	interface BrowserCommands {
		setColorScheme: (scheme: "light" | "dark" | null) => Promise<void>;
	}
}

function probe(): HTMLElement {
	const el = document.createElement("div");
	el.className = "dark:bg-[rgb(255,0,0)] bg-[rgb(0,0,255)]";
	document.body.append(el);
	return el;
}
const bg = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
const RED = "rgb(255, 0, 0)";

describe("dark: variant", () => {
	afterEach(async () => {
		document.documentElement.removeAttribute("data-theme");
		document.body.innerHTML = "";
		await commands.setColorScheme(null);
	});

	it("follows a dark system", async () => {
		await commands.setColorScheme("dark");
		expect(bg(probe())).toBe(RED);
	});

	it("is off for a light system", async () => {
		await commands.setColorScheme("light");
		expect(bg(probe())).not.toBe(RED);
	});

	it('applies under data-theme="dark" on a light system', async () => {
		await commands.setColorScheme("light");
		document.documentElement.dataset.theme = "dark";
		expect(bg(probe())).toBe(RED);
	});

	it('is off under data-theme="light" on a dark system', async () => {
		await commands.setColorScheme("dark");
		document.documentElement.dataset.theme = "light";
		expect(bg(probe())).not.toBe(RED);
	});
});
