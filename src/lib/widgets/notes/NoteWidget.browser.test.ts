import "../../../app.css";
import { expect, test } from "vitest";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { render } from "vitest-browser-svelte";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { noteType } from "./index";
import NoteWidget from "./NoteWidget.svelte";
import SharedHarness from "./test-harness/SharedHarness.svelte";

function note(options: Record<string, unknown>): WidgetInstance {
	return {
		id: "n1",
		type: "note",
		title: null,
		rect: { x: 0, y: 0, w: 4, h: 3 },
		data: { layers: [] },
		options
	};
}

async function editableApp() {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	const id = await app.index.createBlank();
	const session = (await app.sessions.get(id))!;
	app.current = { session, isStarter: false };
	return { app, session, context: new Map([[APP_CONTEXT_KEY, app]]) };
}

test("each block kind renders as a real element", async () => {
	const text = [
		"## Heading",
		"",
		"A **bold** and *italic* word with [a link](https://example.com/a).",
		"",
		"- one",
		"- two",
		"",
		"3. three",
		"4. four"
	].join("\n");
	const screen = await render(NoteWidget, { widget: note({ text }) });
	const root = screen.container;
	expect(root.querySelector("h3")?.textContent).toBe("Heading");
	expect(root.querySelector("strong")?.textContent).toBe("bold");
	expect(root.querySelector("em")?.textContent).toBe("italic");
	expect([...root.querySelectorAll("ul li")].map((l) => l.textContent?.trim())).toEqual([
		"one",
		"two"
	]);
	const ol = root.querySelector("ol")!;
	expect(ol.getAttribute("start")).toBe("3");
	expect(ol.querySelectorAll("li")).toHaveLength(2);
});

test("a link opens in a new tab, says so, and carries the safe rel", async () => {
	const screen = await render(NoteWidget, {
		widget: note({ text: "[the site](https://example.com/a)" })
	});
	const link = screen.container.querySelector("a")!;
	expect(link.getAttribute("href")).toBe("https://example.com/a");
	expect(link.getAttribute("target")).toBe("_blank");
	expect(link.getAttribute("rel")).toBe("ugc nofollow noopener");
	await expect
		.element(screen.getByRole("link", { name: `the site ${m.opens_in_new_tab()}` }))
		.toBeInTheDocument();
});

test("markup in the text stays inert", async () => {
	const screen = await render(NoteWidget, {
		widget: note({ text: "<img src=x onerror=alert(1)> [x](javascript:alert(1))" })
	});
	expect(screen.container.querySelector("img")).toBeNull();
	expect(screen.container.querySelector("a")).toBeNull();
});

test("the welcome message shows its text", async () => {
	const screen = await render(NoteWidget, { widget: note({ message: "starter_note_welcome" }) });
	await expect.element(screen.getByText("Welcome to the SJVAir Dashboard.")).toBeInTheDocument();
	expect(screen.container.querySelector("strong")).not.toBeNull();
});

test("an empty Note shows the hint where editing is possible", async () => {
	const { context } = await editableApp();
	const screen = await render(NoteWidget, { props: { widget: note({ text: "" }) }, context });
	await expect.element(screen.getByText(m.note_empty_hint())).toBeInTheDocument();
});

test("an unknown message key reads as empty and shows the hint", async () => {
	const { context } = await editableApp();
	const screen = await render(NoteWidget, {
		props: { widget: note({ message: "no_such_message" }) },
		context
	});
	await expect.element(screen.getByText(m.note_empty_hint())).toBeInTheDocument();
});

test("an empty Note shows no hint on a read-only dashboard, reactively", async () => {
	const { context, session } = await editableApp();
	const screen = await render(NoteWidget, { props: { widget: note({ text: "" }) }, context });
	await expect.element(screen.getByText(m.note_empty_hint())).toBeInTheDocument();
	session.readOnly = "invalid";
	await expect.poll(() => screen.getByText(m.note_empty_hint()).query()).toBeNull();
});

test("an empty Note shows nothing when read-only (a shared link)", async () => {
	const screen = await render(SharedHarness, { widget: note({ text: "" }) });
	expect(screen.container.textContent?.trim()).toBe("");
});

test("long text scrolls inside the widget", async () => {
	const text = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}`).join("\n\n");
	const screen = await render(NoteWidget, { widget: note({ text }) });
	const box = screen.container.querySelector<HTMLElement>("[data-widget]")!;
	box.style.height = "100px";
	expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);
	expect(getComputedStyle(box).overflowY).toBe("auto");
});

test("the descriptor is a time-less, direct-add type", () => {
	expect(noteType.time).toBe("none");
	expect(noteType.accepts).toBeUndefined();
	expect(noteType.addable?.()).toEqual({ data: { layers: [] }, options: { text: "" } });
});
