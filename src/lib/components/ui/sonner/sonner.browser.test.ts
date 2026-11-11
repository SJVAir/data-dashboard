import "../../../../app.css";
import { toast } from "svelte-sonner";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import ActionBar from "$lib/get-data/ActionBar.svelte";
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

test("toasts sit above Get data's action bar while it's on screen, so none covers its buttons", async () => {
	render(Toaster);
	// The bar pinned at the window's bottom, as on the Get data view.
	const holder = document.createElement("div");
	holder.style.position = "fixed";
	holder.style.insetInline = "0";
	holder.style.bottom = "0";
	document.body.append(holder);
	const bar = await render(ActionBar, {
		target: holder,
		props: { downloading: false, oncancel: () => {}, ondownload: () => {} }
	});
	toast.info("Saved a copy", { duration: Infinity });
	const shown = page.getByText("Saved a copy");
	await expect.element(shown).toBeVisible();
	const toastBottom = () =>
		document.querySelector("[data-sonner-toast]")!.getBoundingClientRect().bottom;
	const barTop = holder.getBoundingClientRect().top;
	expect(barTop).toBeLessThan(innerHeight);
	await expect.poll(toastBottom).toBeLessThanOrEqual(barTop);
	// Once the bar has gone, toasts go back to their usual place near the bottom.
	await bar.unmount();
	holder.remove();
	await expect.poll(toastBottom).toBeGreaterThan(barTop);
});
