import { expect, test, vi } from "vitest";
import { flushSync } from "svelte";
import { CURRENT_SCHEMA_VERSION, type Dashboard } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import { DocumentSession } from "$lib/store/document-session.svelte";
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
