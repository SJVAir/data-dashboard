import { describe, expect, it, vi } from "vitest";
import { z } from "$lib/zod";
import type { Migration } from "$lib/documents/load";
import { CURRENT_SCHEMA_VERSION, type Dashboard } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { AppContext } from "$lib/store/app.svelte";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { restoreOriginal } from "./restore-version";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

const SPACE = "anonymous";
const OLD = CURRENT_SCHEMA_VERSION - 1;
const NOW = new Date("2026-10-20T12:00:00.000Z");

const widget = (id: string) => ({
	id,
	type: "placeholder",
	title: null,
	rect: { x: 0, y: 0, w: 6, h: 4 },
	data: { layers: [] }
});

const old = {
	kind: "dashboard",
	schemaVersion: OLD,
	id: "d1",
	name: "Before",
	version: 0,
	createdAt: "2026-10-20T00:00:00.000Z",
	updatedAt: "2026-10-20T00:00:00.000Z",
	body: { widgets: [widget("a"), widget("b")] }
};

function chain(migrate: (raw: object) => unknown = (raw) => raw): Migration[] {
	return [
		{
			from: OLD,
			to: CURRENT_SCHEMA_VERSION,
			schema: z.unknown(),
			migrate: (raw) => migrate({ ...(raw as object), schemaVersion: CURRENT_SCHEMA_VERSION }),
			migrateChange: (change) => change
		}
	];
}

async function setup() {
	const platform = createMemoryPlatform();
	await platform.documents.commit(SPACE, {
		docId: "d1",
		baseVersion: null,
		doc: old as unknown as Dashboard,
		entries: []
	});
	const session = (await DocumentSession.open(platform, SPACE, "d1", "tab-1", {
		debounceMs: 60_000,
		now: () => NOW,
		chain: chain()
	}))!;
	// The person kept working after the update.
	session.apply({ op: "setField", target: { path: "name" }, from: "Before", to: "After" });
	session.apply({ op: "removeWidget", target: { widgetId: "b" }, widget: widget("b"), index: 1 });
	const app = { platform, space: SPACE } as unknown as AppContext;
	return { app, session, platform };
}

describe("restoreOriginal", () => {
	it("replaces name and body in one undoable change", async () => {
		const { app, session } = await setup();
		expect(session.hasOriginal).toBe(true);
		expect(await restoreOriginal(app, session, chain())).toBe(true);
		expect(session.doc.name).toBe("Before");
		expect(session.doc.body.widgets.map((w) => w.id)).toEqual(["a", "b"]);

		session.undo();
		expect(session.doc.name).toBe("After");
		expect(session.doc.body.widgets.map((w) => w.id)).toEqual(["a"]);
		session.dispose();
	});

	it("returns false and leaves the document when the original fails the pipeline", async () => {
		const { app, session } = await setup();
		const before = JSON.stringify(session.doc);
		const broken = chain((raw) => ({ ...raw, body: "broken" }));
		expect(await restoreOriginal(app, session, broken)).toBe(false);
		expect(JSON.stringify(session.doc)).toBe(before);
		session.dispose();
	});
});
