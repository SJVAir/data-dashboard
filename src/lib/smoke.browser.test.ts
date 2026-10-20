import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Home from "../routes/Home.svelte";

test("Home renders the app name", async () => {
	const screen = await render(Home);
	await expect.element(screen.getByText("SJVAir Workspace")).toBeInTheDocument();
});
