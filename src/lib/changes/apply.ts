import type { Dashboard } from "$lib/documents/schema";
import { changedFields } from "./placement";
import type { Change, Placement } from "./types";

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
		case "setLayout": {
			// Only ids still in the document apply, and only the fields each entry changes (another
			// tab may have set the rest). The inverse restores what was really there.
			const from: Record<string, Placement> = {};
			const to: Record<string, Placement> = {};
			const next = widgets.map((w) => {
				if (!change.target.widgetIds.includes(w.id) || !Object.hasOwn(change.to, w.id)) return w;
				const requested = change.to[w.id];
				const sets = changedFields(
					Object.hasOwn(change.from, w.id) ? change.from[w.id] : undefined,
					requested
				);
				const actual: Placement = { rect: w.rect, minimized: w.minimized ?? null };
				const placement: Placement = {
					rect: sets.rect ? requested.rect : actual.rect,
					minimized: sets.minimized ? requested.minimized : actual.minimized
				};
				from[w.id] = actual;
				to[w.id] = placement;
				const moved = { ...w, rect: placement.rect };
				if (placement.minimized) moved.minimized = placement.minimized;
				else delete moved.minimized;
				return moved;
			});
			const widgetIds = Object.keys(to);
			if (widgetIds.length === 0) throw new ChangeTargetMissing("No widget in the layout change");
			return {
				doc: { ...doc, body: { ...doc.body, widgets: next } },
				inverse: { op: "setLayout", target: { widgetIds }, from: to, to: from }
			};
		}
		case "replaceDocument": {
			// The inverse restores what was really there; `change.from` may be stale (rebase).
			return {
				doc: { ...doc, name: change.to.name, body: change.to.body },
				inverse: {
					op: "replaceDocument",
					target: {},
					from: change.to,
					to: { name: doc.name, body: doc.body }
				}
			};
		}
	}
}

/**
 * The change exactly as `applyChange` carried it out, rebuilt from its inverse: the clamped
 * insert index, the widget actually removed, and the field's actual prior value as `from`.
 * Rebase and undo record this rather than the requested change, whose details may be stale.
 */
export function appliedChange(inverse: Change): Change {
	switch (inverse.op) {
		case "addWidget":
			return { ...inverse, op: "removeWidget" };
		case "removeWidget":
			return { ...inverse, op: "addWidget" };
		case "setField":
			return { ...inverse, from: inverse.to, to: inverse.from };
		case "setLayout":
			return { ...inverse, from: inverse.to, to: inverse.from };
		case "replaceDocument":
			return { ...inverse, from: inverse.to, to: inverse.from };
	}
}
