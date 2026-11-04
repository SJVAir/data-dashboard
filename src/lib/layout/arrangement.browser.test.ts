import { expect, test, vi } from "vitest";
import { flushSync } from "svelte";
import { CURRENT_SCHEMA_VERSION, type Dashboard } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { starterSession } from "$lib/starter/starter";
import { Arrangement } from "./arrangement.svelte";

test("the dragged widget deleted elsewhere cancels without further input", () => {
	const a = {
		id: "a",
		type: "placeholder",
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 4 },
		data: { layers: [] }
	};
	const doc: Dashboard = {
		kind: "dashboard",
		schemaVersion: CURRENT_SCHEMA_VERSION,
		id: "d1",
		name: null,
		version: 0,
		createdAt: "2026-10-20T00:00:00.000Z",
		updatedAt: "2026-10-20T00:00:00.000Z",
		body: { widgets: [a] }
	};
	const session = new DocumentSession({
		platform: createMemoryPlatform(),
		space: "anonymous",
		doc,
		tabId: "tab-1",
		debounceMs: 60_000
	});
	const onGone = vi.fn();
	const arrangement = new Arrangement(
		() => session,
		() => 12,
		{ onGone }
	);
	arrangement.pickUp("a", "move", "pointer");
	flushSync();
	expect(onGone).not.toHaveBeenCalled();

	session.apply({ op: "removeWidget", target: { widgetId: "a" }, widget: a, index: 0 });
	flushSync();
	expect(onGone).toHaveBeenCalledExactlyOnceWith("a");
	expect(arrangement.active).toBeNull();
	flushSync();
	expect(onGone).toHaveBeenCalledTimes(1);
	arrangement.dispose();
	session.dispose();
});

test("a second drop on the starter's page, after its copy took over, carries focus to the copy's page", async () => {
	const platform = createMemoryPlatform();
	let current: DocumentSession | null = null;
	const starter = starterSession({
		platform,
		space: "anonymous",
		tabId: "tab-1",
		onCopied: (copy) => (current = copy)
	});
	current = starter;
	// The starter's page: its session is whatever the app has current.
	const page = new Arrangement(
		() => current,
		() => 12
	);
	page.pickUp("starter-1", "move", "keyboard");
	page.moveTo({ x: 6, y: 0 });
	expect(page.drop()).not.toBeNull();
	// The copy is made and current; the page hasn't switched to it yet.
	await vi.waitFor(() => expect(current).not.toBe(starter));
	const copy = current!;
	const second = copy.doc.body.widgets.find((w) => w.id !== "starter-1")!.id;
	page.pickUp(second, "move", "keyboard");
	page.moveTo({ x: 0, y: 30 });
	expect(page.drop()).not.toBeNull();
	page.dispose();

	// The copy's own page.
	const next = new Arrangement(
		() => copy,
		() => 12
	);
	expect(next.pendingFocus).toBe(second);
	next.dispose();
	copy.dispose();
	starter.dispose();
});
