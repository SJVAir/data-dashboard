import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { commands, userEvent } from "vitest/browser";
import "../../../app.css";
import DayStepper from "./DayStepper.svelte";
import type { MapLevel, Stop } from "./days";

declare module "vitest/browser" {
	interface BrowserCommands {
		setColorScheme: (scheme: "light" | "dark" | null) => Promise<void>;
	}
}

/** A token's color, resolved the way the browser resolves it in an outline or a shadow. */
function tokenColor(token: string): string {
	const probe = document.createElement("span");
	probe.style.color = `var(${token})`;
	document.body.append(probe);
	const color = getComputedStyle(probe).color;
	probe.remove();
	return color;
}

const STOPS: Stop[] = [
	{ at: "2026-11-06" },
	{ at: "2026-11-07" },
	{ at: "2026-11-08" },
	{ at: "2026-11-09" },
	{ at: "2026-11-10" },
	{ at: "2026-11-11" },
	{ at: "2026-11-12" },
	{ at: "2026-11-13" },
	{ at: "2026-11-14" },
	"now"
];

const MONTHS: Stop[] = [
	{ at: "2026-08-01" },
	{ at: "2026-09-01" },
	{ at: "2026-10-01" },
	{ at: "2026-11-01", soFar: true }
];

async function setup(over: Record<string, unknown> = {}) {
	const onstep = vi.fn();
	const ondragend = vi.fn();
	const props = {
		stops: STOPS,
		resolution: "day" as MapLevel,
		at: 4,
		notFinal: false,
		narrow: false,
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

	it("adds not final yet to the slider's value text when the day isn't final", async () => {
		const { screen } = await setup({ notFinal: true });
		await expect
			.element(screen.getByRole("slider", { name: "Day" }))
			.toHaveAttribute("aria-valuetext", "Tuesday, November 10, 2026, not final yet");
	});

	it("adds not final yet to Now's value text too", async () => {
		const { screen } = await setup({ at: 9, notFinal: true });
		await expect
			.element(screen.getByRole("slider", { name: "Day" }))
			.toHaveAttribute("aria-valuetext", "Now, not final yet");
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
		const root = container.querySelector('[data-slot="slider"]') as HTMLElement;
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

	it("announces the date through its live region only while the slider isn't focused", async () => {
		const { screen, container } = await setup();
		const status = container.querySelector("[data-day-status]") as HTMLElement;
		expect(status.getAttribute("aria-live")).toBe("polite");
		// The slider announces its own steps (its value text): the live region stays quiet.
		(screen.getByRole("slider").element() as HTMLElement).focus();
		await expect.poll(() => status.getAttribute("aria-live")).toBe("off");
		(screen.getByRole("button", { name: "Next day" }).element() as HTMLElement).focus();
		await expect.poll(() => status.getAttribute("aria-live")).toBe("polite");
	});

	describe.each(["light", "dark"] as const)("the slider's focus (%s)", (scheme) => {
		it("shows the app's focus ring on the thumb, and hover doesn't", async () => {
			await commands.setColorScheme(scheme);
			try {
				const { screen } = await setup();
				const thumb = screen.getByRole("slider").element() as HTMLElement;
				// Hover alone: no ring, so hover never looks like focus.
				await userEvent.hover(thumb);
				let style = getComputedStyle(thumb);
				expect(style.outlineStyle).toBe("none");
				expect(style.boxShadow).not.toContain(tokenColor("--ring-edge"));
				// Keyboard focus: the 2px --ring outline with the --ring-edge ring (contrast.test.ts
				// checks both against the card, the page and the slider's track).
				(screen.getByRole("button", { name: "Previous day" }).element() as HTMLElement).focus();
				await userEvent.tab();
				await expect.poll(() => document.activeElement).toBe(thumb);
				expect(thumb.matches(":focus-visible")).toBe(true);
				style = getComputedStyle(thumb);
				expect(style.outlineStyle).toBe("solid");
				expect(style.outlineWidth).toBe("2px");
				expect(style.outlineColor).toBe(tokenColor("--ring"));
				// The ring (a box-shadow) fades in with the thumb's transition.
				await expect
					.poll(() => getComputedStyle(thumb).boxShadow)
					.toContain(tokenColor("--ring-edge"));
			} finally {
				await commands.setColorScheme(null);
			}
		});
	});

	describe("by month", () => {
		it("labels the months, the current one so far, and names the buttons and slider by month", async () => {
			const { screen } = await setup({ stops: MONTHS, resolution: "month", at: 3 });
			await expect.element(screen.getByText("November 2026 so far")).toBeVisible();
			await expect
				.element(screen.getByRole("slider", { name: "Month" }))
				.toHaveAttribute("aria-valuetext", "November 2026 so far");
			await expect.element(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
			await expect.element(screen.getByRole("button", { name: "Previous month" })).toBeEnabled();
		});

		it("steps by month with the keyboard and keeps focus on the stepper", async () => {
			const onstep = vi.fn();
			const props = {
				stops: MONTHS,
				resolution: "month" as const,
				at: 3,
				notFinal: false,
				narrow: false,
				onstep,
				ondragend: () => {}
			};
			const screen = await render(DayStepper, props);
			onstep.mockImplementation((index: number) => screen.rerender({ ...props, at: index }));
			const thumb = screen.getByRole("slider", { name: "Month" }).element() as HTMLElement;
			thumb.focus();
			await userEvent.keyboard("{ArrowLeft}");
			await expect.element(screen.getByText("October 2026", { exact: true })).toBeVisible();
			expect(document.activeElement).toBe(thumb);
			await userEvent.keyboard("{Home}");
			await expect.element(screen.getByText("August 2026", { exact: true })).toBeVisible();
			expect(document.activeElement).toBe(thumb);
			await userEvent.keyboard("{End}");
			await expect.element(screen.getByText("November 2026 so far")).toBeVisible();
			expect(document.activeElement).toBe(thumb);
			expect(onstep).toHaveBeenCalledTimes(3);
		});

		it("shows a month's message when there are no stops", async () => {
			const { screen } = await setup({ stops: [], resolution: "month", at: 0 });
			await expect.element(screen.getByText("No months to show yet")).toBeVisible();
		});

		it("labels a year", async () => {
			const { screen } = await setup({
				stops: [{ at: "2025-01-01" }, { at: "2026-01-01", soFar: true }],
				resolution: "year",
				at: 0
			});
			await expect.element(screen.getByText("2025", { exact: true })).toBeVisible();
			await expect.element(screen.getByRole("button", { name: "Next year" })).toBeEnabled();
		});
	});

	it("has no axe violations", async () => {
		const { container } = await setup({ notFinal: true });
		const results = await axe.run(container);
		expect(results.violations).toEqual([]);
	});
});
