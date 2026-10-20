import type { Dashboard } from "$lib/documents/schema";
import type { Change } from "./types";

/** The change names a widget that is not in the document (or, for add, one that already is). */
export class ChangeTargetMissing extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ChangeTargetMissing";
	}
}

/**
 * Apply one change. Pure: never mutates `doc`, never touches `version`/`updatedAt`.
 * Returns the new document and the inverse change (applying it restores the original).
 * Name/title values are applied as given; callers normalize them (`normalizeName`).
 */
export function applyChange(doc: Dashboard, change: Change): { doc: Dashboard; inverse: Change } {
	const widgets = doc.body.widgets;

	switch (change.op) {
		case "addWidget": {
			if (widgets.some((w) => w.id === change.widget.id)) {
				throw new ChangeTargetMissing(`Widget ${change.widget.id} already exists`);
			}
			const index = Math.min(change.index, widgets.length);
			const next = [...widgets.slice(0, index), change.widget, ...widgets.slice(index)];
			return {
				doc: { ...doc, body: { ...doc.body, widgets: next } },
				inverse: {
					op: "removeWidget",
					target: { widgetId: change.widget.id },
					widget: change.widget,
					index
				}
			};
		}
		case "removeWidget": {
			const index = widgets.findIndex((w) => w.id === change.target.widgetId);
			if (index === -1) throw new ChangeTargetMissing(`No widget ${change.target.widgetId}`);
			const removed = widgets[index];
			return {
				doc: { ...doc, body: { ...doc.body, widgets: widgets.filter((_, i) => i !== index) } },
				inverse: { op: "addWidget", target: change.target, widget: removed, index }
			};
		}
		case "setField": {
			// The inverse restores what was really there; `change.from` may be stale (rebase).
			const invert = (actual: string | null): Change => ({
				...change,
				from: change.to,
				to: actual
			});
			const { path, widgetId } = change.target;
			if (path === "title") {
				const index = widgets.findIndex((w) => w.id === widgetId);
				if (index === -1) throw new ChangeTargetMissing(`No widget ${widgetId}`);
				const next = widgets.map((w, i) => (i === index ? { ...w, title: change.to } : w));
				return {
					doc: { ...doc, body: { ...doc.body, widgets: next } },
					inverse: invert(widgets[index].title)
				};
			}
			if (path === "name") return { doc: { ...doc, name: change.to }, inverse: invert(doc.name) };
			const inverse = invert(doc.deletedAt ?? null);
			if (change.to === null) {
				const rest = { ...doc };
				delete rest.deletedAt;
				return { doc: rest, inverse };
			}
			return { doc: { ...doc, deletedAt: change.to }, inverse };
		}
	}
}
