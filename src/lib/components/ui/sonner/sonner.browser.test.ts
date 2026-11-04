import "../../../../app.css";
import { toast } from "svelte-sonner";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import Toaster from "./sonner.svelte";

afterEach(() => {
	toast.dismiss();
	document.documentElement.removeAttribute("data-theme");
});

async function toasterTheme(): Promise<string | null> {
	await expect.element(page.getByText("Saved a copy")).toBeVisible();
	return document.querySelector("[data-sonner-toaster]")!.getAttribute("data-sonner-theme");
}

test("toasts follow the page's theme override, including a switch while shown", async () => {
	document.documentElement.setAttribute("data-theme", "dark");
	render(Toaster);
	toast.info("Saved a copy");
	expect(await toasterTheme()).toBe("dark");
	document.documentElement.setAttribute("data-theme", "light");
	await expect
		.poll(() => document.querySelector("[data-sonner-toaster]")!.getAttribute("data-sonner-theme"))
		.toBe("light");
});

test("with no override, toasts follow the system scheme", async () => {
	render(Toaster);
	toast.info("Saved a copy");
	const system = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	expect(await toasterTheme()).toBe(system);
});
