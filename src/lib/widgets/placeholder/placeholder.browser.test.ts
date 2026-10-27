import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { m } from "$lib/paraglide/messages.js";
import { newPlaceholder } from "./index";
import Placeholder from "./Placeholder.svelte";

test("Placeholder renders its body message", async () => {
	const screen = await render(Placeholder, { widget: newPlaceholder([]) });
	await expect.element(screen.getByText(m.widget_placeholder_body())).toBeInTheDocument();
	expect(m.widget_placeholder_body()).toBe("This is a placeholder widget.");
});
