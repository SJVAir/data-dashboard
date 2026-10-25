import { CURRENT_SCHEMA_VERSION, type Dashboard } from "$lib/documents/schema";
import { PLACEHOLDER_TYPE } from "$lib/widgets/placeholder";

export function widget(i: number, title: string | null = null) {
	return {
		id: `w${i}`,
		type: PLACEHOLDER_TYPE,
		title,
		rect: { x: 0, y: i, w: 6, h: 1 },
		data: { layers: [] }
	};
}

export function makeDoc(widgets = 2): Dashboard {
	return {
		kind: "dashboard",
		schemaVersion: CURRENT_SCHEMA_VERSION,
		id: "src-1",
		name: "Fresno schools",
		copiedFrom: "older",
		deletedAt: "2026-10-01T00:00:00.000Z",
		version: 7,
		createdAt: "2026-10-01T00:00:00.000Z",
		updatedAt: "2026-10-02T00:00:00.000Z",
		body: { widgets: Array.from({ length: widgets }, (_, i) => widget(i, `Widget ${i}`)) }
	};
}
