import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import "../../../app.css";
import DayStepper from "./DayStepper.svelte";
import type { Stop } from "./days";

const STOPS: Stop[] = [
	{ day: "2026-11-06" },
	{ day: "2026-11-07" },
	{ day: "2026-11-08" },
	{ day: "2026-11-09" },
	{ day: "2026-11-10" },
	{ day: "2026-11-11" },
	{ day: "2026-11-12" },
	{ day: "2026-11-13" },
	{ day: "2026-11-14" },
	"now"
];

async function setup(over: Record<string, unknown> = {}) {
	const onstep = vi.fn();
	const ondragend = vi.fn();
	const props = {
		stops: STOPS,
		at: 4,
		notFinal: false,
		narrow: false,
		readOnly: false,
		onstep,
		ondragend,
		...over
	};
	const screen = await render(DayStepper, props);
	return { screen, container: screen.container, onstep, ondragend };
}

describe("DayStepper", () => {
	it("shows the stop's long Pacific date, or Now, with Not final yet beside it", async () => {
		const { screen } = await setup({ notFinal: true });
		await expect.element(screen.getByText("Tuesday, November 10, 2026")).toBeVisible();
		await expect.element(screen.getByText("Not final yet")).toBeVisible();
	});

	it("shows Now for the now stop", async () => {
		const { screen } = await setup({ at: 9 });
		await expect.element(screen.getByText("Now", { exact: true })).toBeVisible();
	});

	it("disables Previous at the first stop; Next calls onstep", async () => {
		const { screen, onstep } = await setup({ at: 0 });
		await expect.element(screen.getByRole("button", { name: "Previous day" })).toBeDisabled();
		await screen.getByRole("button", { name: "Next day" }).click();
		expect(onstep).toHaveBeenCalledWith(1, "button");
	});

	it("disables Next at the last stop; Previous calls onstep", async () => {
		const { screen, onstep } = await setup({ at: 9 });
		await expect.element(screen.getByRole("button", { name: "Next day" })).toBeDisabled();
		await screen.getByRole("button", { name: "Previous day" }).click();
		expect(onstep).toHaveBeenCalledWith(8, "button");
	});

	it("gives the slider the date as its value text", async () => {
		const { screen } = await setup();
		await expect
			.element(screen.getByRole("slider", { name: "Day" }))
			.toHaveAttribute("aria-valuetext", "Tuesday, November 10, 2026");
	});

	it("gives the slider Now as its value text on the now stop", async () => {
		const { screen } = await setup({ at: 9 });
		await expect
			.element(screen.getByRole("slider", { name: "Day" }))
			.toHaveAttribute("aria-valuetext", "Now");
	});

	it.each([
		["ArrowLeft", 3],
		["ArrowDown", 3],
		["ArrowRight", 5],
		["ArrowUp", 5],
		["PageDown", 0],
		["PageUp", 9],
		["Home", 0],
		["End", 9]
	])("%s moves the slider to stop %i", async (key, to) => {
		const { screen, onstep } = await setup();
		(screen.getByRole("slider").element() as HTMLElement).focus();
		await userEvent.keyboard(`{${key}}`);
		expect(onstep).toHaveBeenCalledTimes(1);
		expect(onstep).toHaveBeenCalledWith(to, "key");
	});

	it("doesn't step past the ends", async () => {
		const { screen, onstep } = await setup({ at: 0 });
		(screen.getByRole("slider").element() as HTMLElement).focus();
		await userEvent.keyboard("{ArrowLeft}");
		expect(onstep).not.toHaveBeenCalled();
	});

	it("reports a pointer move on the slider as a slider step, then the end of the drag", async () => {
		const { container, onstep, ondragend } = await setup();
		const root = container.querySelector("[data-slider-root]") as HTMLElement;
		const box = root.getBoundingClientRect();
		const y = box.top + box.height / 2;
		const fire = (type: string, x: number) =>
			root.dispatchEvent(
				new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0 })
			);
		fire("pointerdown", box.left + 2);
		document.dispatchEvent(
			new PointerEvent("pointerup", { clientX: box.left + 2, clientY: y, bubbles: true })
		);
		expect(onstep).toHaveBeenCalledWith(0, "slider");
		expect(ondragend).toHaveBeenCalled();
	});

	it("has no slider when narrow, but keeps the buttons and the date", async () => {
		const { screen } = await setup({ narrow: true });
		expect(screen.getByRole("slider").elements()).toHaveLength(0);
		await expect.element(screen.getByRole("button", { name: "Next day" })).toBeVisible();
		await expect.element(screen.getByText("Tuesday, November 10, 2026")).toBeVisible();
	});

	it("shows only a message when there are no stops", async () => {
		const { screen } = await setup({ stops: [], at: 0 });
		await expect.element(screen.getByText("No days to show yet")).toBeVisible();
		expect(screen.getByRole("button").elements()).toHaveLength(0);
		expect(screen.getByRole("slider").elements()).toHaveLength(0);
	});

	it("still steps when read only", async () => {
		const { screen, onstep } = await setup({ readOnly: true });
		await screen.getByRole("button", { name: "Next day" }).click();
		expect(onstep).toHaveBeenCalledWith(5, "button");
	});

	it("has no axe violations", async () => {
		const { container } = await setup({ notFinal: true });
		const results = await axe.run(container);
		expect(results.violations).toEqual([]);
	});
});
