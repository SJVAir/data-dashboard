import { flushSync } from "svelte";
import { expect, test } from "vitest";
import { generatedTitle, setGeneratedTitle } from "./titles.svelte";

// Two widgets that share one id (the Get data preview) each set a title from an effect.
test("two writers on one id don't wake each other forever", () => {
	const first = "A";
	const second = "B";
	const stop = $effect.root(() => {
		$effect(() => setGeneratedTitle("preview", first));
		$effect(() => setGeneratedTitle("preview", second));
	});
	expect(() => flushSync()).not.toThrow();
	expect(["A", "B"]).toContain(generatedTitle("preview"));
	stop();
});
