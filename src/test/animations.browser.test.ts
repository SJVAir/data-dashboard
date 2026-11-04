import { expect, test } from "vitest";
import { animationsSettled } from "./animations";

test("a cancelled animation rejects `finished` with the AbortError seen in CI", async () => {
	const el = document.createElement("div");
	document.body.append(el);
	const animation = el.animate([{ opacity: 0 }, { opacity: 1 }], 10_000);
	// Taken before cancelling, as the tests' waits do: cancel() rejects it and makes a new one.
	const finished = animation.finished;
	animation.cancel();
	await expect(finished).rejects.toMatchObject({
		name: "AbortError",
		message: "The user aborted a request."
	});
	el.remove();
});

test("animationsSettled waits for running animations and ignores cancelled ones", async () => {
	const el = document.createElement("div");
	document.body.append(el);
	const child = document.createElement("span");
	el.append(child);
	const done = el.animate([{ opacity: 0 }, { opacity: 1 }], 50);
	const cancelled = child.animate([{ opacity: 0 }, { opacity: 1 }], 10_000);
	const settled = animationsSettled(el);
	cancelled.cancel();
	await expect(settled).resolves.toBeUndefined();
	expect(done.playState).toBe("finished");
	el.remove();
});
