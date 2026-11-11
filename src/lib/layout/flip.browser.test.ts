import { afterEach, expect, test } from "vitest";
import { Flip } from "./flip";

let container: HTMLElement | null = null;
afterEach(() => {
	container?.remove();
	container = null;
});

/** A container of two positioned items, with a 200 ms motion token. */
function setup(): { box: HTMLElement; a: HTMLElement; b: HTMLElement } {
	const box = document.createElement("div");
	box.style.setProperty("--motion-duration-base", "200ms");
	box.style.position = "relative";
	const item = (id: string, top: number) => {
		const el = document.createElement("div");
		el.dataset.flipId = id;
		Object.assign(el.style, {
			position: "absolute",
			top: `${top}px`,
			width: "50px",
			height: "50px"
		});
		box.append(el);
		return el;
	};
	const a = item("a", 0);
	const b = item("b", 60);
	document.body.append(box);
	container = box;
	return { box, a, b };
}
const swap = (a: HTMLElement, b: HTMLElement) =>
	([a.style.top, b.style.top] = [b.style.top, a.style.top]);
const running = (...els: HTMLElement[]) => els.flatMap((el) => el.getAnimations()).length;

test("a move animates", () => {
	const { box, a, b } = setup();
	const flip = new Flip();
	flip.measure(box, 12);
	swap(a, b);
	flip.play(box);
	expect(running(a, b)).toBe(2);
});

test("after the columns change the next play jumps", () => {
	const { box, a, b } = setup();
	const flip = new Flip();
	flip.measure(box, 12);
	flip.play(box);
	flip.measure(box, 1);
	swap(a, b);
	flip.play(box);
	expect(running(a, b)).toBe(0);
	flip.measure(box, 1);
	swap(a, b);
	flip.play(box);
	expect(running(a, b)).toBe(2);
});

test("a jump asked for at measure is for that play only", () => {
	const { box, a, b } = setup();
	const flip = new Flip();
	flip.measure(box, 1);
	flip.play(box);
	flip.measure(box, 1, true);
	flip.play(box);
	flip.measure(box, 1);
	swap(a, b);
	flip.play(box);
	expect(running(a, b)).toBe(2);
});
